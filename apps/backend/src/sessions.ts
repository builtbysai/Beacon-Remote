import { createHash, createHmac, randomUUID } from "node:crypto";
import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Config } from "./config.js";
import { relayCredentials, relayExpiry } from "./relay.js";

type Session = {
  id: string;
  account_id: string;
  machine_id: string;
  source: "desktop" | "synthetic";
  capability: "desktop:view" | "desktop:control";
  expires_at: Date | null;
  created_at: Date;
  status: string;
  approval: "local" | "policy";
  policy_version: number | null;
};
type Role = "viewer" | "machine";
type Authorization = { session: Session; role: Role; request: FastifyRequest };
type Entry = {
  viewer?: WebSocket;
  machine?: WebSocket;
  timer?: ReturnType<typeof setInterval>;
  closed: boolean;
  serial: Promise<void>;
  frames: number;
  frameWindow: number;
  pendingFrames: number;
  resumable?: boolean;
  viewerRequest?: FastifyRequest;
  viewerTokenHash?: string;
  detachedUntil?: number;
  relayRefreshAt?: number;
  // How long a session waits for its viewer to come back after the connection drops.
  reconnectMs: number;
  generation: number;
};
// Attended sessions wait two minutes, trusted ones five (ADR 0021). Capture and input stay
// stopped while nobody is attached, and nothing in this window can revive an ended session.
const RECONNECT_ATTENDED_MS = 120_000;
const RECONNECT_TRUSTED_MS = 300_000;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const params = z.object({ id: z.uuid() });
const signal = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("retry"),
      generation: z.number().int().min(0).max(16),
    })
    .strict(),
  z
    .object({
      type: z.literal("offer"),
      sdp: z.string().min(1).max(32768),
      generation: z.number().int().min(0).max(16).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("answer"),
      sdp: z.string().min(1).max(32768),
      generation: z.number().int().min(0).max(16).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("candidate"),
      candidate: z.string().max(2048),
      sdpMid: z.string().max(32).nullable(),
      sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
      generation: z.number().int().min(0).max(16).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("consent"),
      accepted: z.boolean(),
      resumable: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("renew"),
      nonce: z.string().regex(/^[0-9]{1,20}$/),
    })
    .strict(),
  z.object({ type: z.literal("stop") }).strict(),
]);

// Signaling peers and consent leases belong to one process. A restarted backend
// cannot recover them from persisted status, even when the grant has time left.
// Run once at process startup, before listening, with the prior backend stopped.
export async function endInterruptedSessions(pool: Pool) {
  await pool.query(`WITH interrupted AS (
    UPDATE view_sessions SET status='ended'
    WHERE status IN ('requested','connecting','active')
    RETURNING account_id,machine_id,capability
  )
  INSERT INTO audit_events(account_id,machine_id,action)
  SELECT account_id,machine_id,CASE WHEN capability='desktop:control' THEN 'desktop.control.interrupted:backend-restart' ELSE 'desktop.view.interrupted:backend-restart' END
  FROM interrupted`);
}

export async function registerSessions(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  owner: (request: FastifyRequest) => Promise<string | null>,
) {
  await app.register(websocket, {
    options: { maxPayload: 65536, perMessageDeflate: false },
  });
  const entries = new Map<string, Entry>();
  const authorized = new WeakMap<FastifyRequest, Authorization>();
  const enabled = Boolean(config.SESSION_SECRET);
  // What keeps a session alive (ADR 0021): it has not passed its absolute cap, an unanswered
  // request is under two minutes old, and, for a policy session, the computer's policy still
  // allows what was granted. Sign-in and revocation are re-checked on every lease renewal.
  function liveDuration(alias: string, seconds = 0) {
    return `(${alias}.expires_at>now()+interval '${seconds} seconds' AND (${alias}.status='active' OR ${alias}.created_at>now()-interval '120 seconds') AND (${alias}.approval='local' OR EXISTS (SELECT 1 FROM machine_access pa WHERE pa.machine_id=${alias}.machine_id AND pa.mode='trusted' AND pa.version=${alias}.policy_version AND (${alias}.capability<>'desktop:control' OR pa.allow_control))))`;
  }
  // Clients are told 0, meaning no fixed expiry: the cap is enforced here and the lease is the clock.
  const expiryMillis = (_session: Session) => 0;
  const controlEnabled = enabled && config.CONTROL_ENABLED === "true";
  const reconnectSeconds = (session: Session) =>
    config.RECONNECT_WINDOW_SECONDS ??
    (session.approval === "policy"
      ? RECONNECT_TRUSTED_MS / 1000
      : RECONNECT_ATTENDED_MS / 1000);
  let closing = false;
  const waiters = new Map<string, () => void>();
  function wake(machineId: string) {
    waiters.get(machineId)?.();
  }
  function waitForRequest(machineId: string, signal?: AbortSignal) {
    // One bounded waiter per authenticated machine, outside the database pool.
    wake(machineId);
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      if (waiters.get(machineId) === finish) waiters.delete(machineId);
      resolve();
    };
    const timer = setTimeout(finish, 15000);
    waiters.set(machineId, finish);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
    return { promise, finish };
  }
  app.addHook("preClose", async () => {
    closing = true;
    for (const finish of [...waiters.values()]) finish();
  });
  app.get("/api/sessions", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const query = z
      .object({ machineId: z.uuid().optional() })
      .strict()
      .safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: "Invalid session filter" });
    if (!enabled) return { available: false, sessions: [] };
    const result = await pool.query(
      `SELECT s.id, m.name AS "machineName", s.source, s.capability,
       CASE WHEN NOT ${liveDuration("s")} AND s.status IN ('requested','connecting','active') THEN 'expired' ELSE s.status END AS status,
       s.created_at AS "createdAt", s.expires_at AS "expiresAt"
       FROM view_sessions s JOIN machines m ON m.id=s.machine_id AND m.account_id=s.account_id
       WHERE s.account_id=$1 AND ($2::uuid IS NULL OR s.machine_id=$2)
       ORDER BY s.created_at DESC,s.id LIMIT 100`,
      [account, query.data.machineId ?? null],
    );
    return { available: true, sessions: result.rows };
  });
  const iceServers = [
    { urls: [config.STUN_URL ?? "stun:129.213.128.206:3478"] },
  ];
  const iceTransportPolicy = config.ICE_TRANSPORT_POLICY ?? "all";
  function sessionIce(session: Session) {
    if (!config.TURN_URLS || !config.TURN_SECRET) return iceServers;
    const relay = relayCredentials(
      config,
      session.id,
      relayExpiry(session.expires_at ?? new Date(0)),
    );
    return [
      ...iceServers,
      {
        urls: relay.urls,
        username: relay.username,
        credential: relay.credential,
      },
    ];
  }
  function token(session: Session) {
    if (!config.SESSION_SECRET) throw new Error("View sessions disabled");
    return createHmac("sha256", Buffer.from(config.SESSION_SECRET, "hex"))
      .update(
        `beacon-remote:view:v1\n${session.id}\n${session.machine_id}\n${session.source}\n${expiryMillis(session)}${session.capability === "desktop:control" ? "\ndesktop:control" : ""}`,
      )
      .digest("base64url");
  }
  function send(socket: WebSocket | undefined, body: unknown) {
    if (socket?.readyState === 1) {
      if (socket.bufferedAmount > 131072) {
        socket.terminate();
        return;
      }
      socket.send(JSON.stringify(body));
    }
  }
  const browserHash = (request: FastifyRequest) =>
    digest(request.cookies.remote_session ?? "");
  function detachViewer(entry: Entry, socket: WebSocket) {
    if (entry.closed || entry.viewer !== socket) return;
    entry.viewer = undefined;
    entry.detachedUntil = performance.now() + entry.reconnectMs;
    send(entry.machine, { type: "viewer-detached" });
  }
  async function finish(id: string, status: "ended" | "denied" = "ended") {
    const entry = entries.get(id);
    if (entry?.closed) return;
    if (entry) {
      entry.closed = true;
      clearInterval(entry.timer);
    }
    try {
      await pool.query(
        "UPDATE view_sessions SET status=$2 WHERE id=$1 AND status IN ('requested','connecting','active')",
        [id, status],
      );
    } finally {
      if (entry) {
        send(entry.viewer, { type: "ended", reason: status });
        entry.viewer?.close(1000);
        entry.machine?.close(1000);
        // A stalled peer must not retain socket buffers for ws's 30-second default.
        const closing = [entry.viewer, entry.machine];
        const timeout = setTimeout(() => {
          for (const socket of closing) {
            if (socket && socket.readyState !== 3) socket.terminate();
          }
        }, 1000);
        timeout.unref();
        entries.delete(id);
      }
    }
  }

  app.get("/api/media/config", async (request, reply) => {
    if (!(await owner(request)))
      return reply.code(401).send({ error: "Sign in required" });
    return {
      enabled,
      controlEnabled,
      iceServers,
      capability: "desktop:view",
      maxSeconds: null,
    };
  });
  app.post(
    "/api/machines/:id/sessions",
    { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (request.headers.origin !== config.WEB_ORIGIN)
        return reply.code(403).send({ error: "Origin rejected" });
      const account = await owner(request);
      if (!account) return reply.code(401).send({ error: "Sign in required" });
      if (!enabled)
        return reply.code(503).send({ error: "View sessions disabled" });
      const parsed = params.safeParse(request.params);
      const body = z
        .object({
          source: z.enum(["desktop", "synthetic"]),
          capability: z
            .enum(["desktop:view", "desktop:control"])
            .default("desktop:view"),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success || !body.success)
        return reply.code(400).send({ error: "Invalid session" });
      if (
        body.data.capability === "desktop:control" &&
        (!controlEnabled || body.data.source !== "desktop")
      )
        return reply.code(403).send({ error: "Control unavailable" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const machine = await client.query(
          "SELECT id FROM machines WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND last_seen_at>now()-interval '45 seconds' FOR UPDATE",
          [parsed.data.id, account],
        );
        if (!machine.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Computer unavailable" });
        }
        await client.query(
          `UPDATE view_sessions s SET status='ended' WHERE machine_id=$1 AND NOT ${liveDuration("s")} AND status IN ('requested','connecting','active')`,
          [parsed.data.id],
        );
        const busy = await client.query(
          "SELECT 1 FROM view_sessions WHERE machine_id=$1 AND status IN ('requested','connecting','active')",
          [parsed.data.id],
        );
        if (busy.rowCount) {
          await client.query("ROLLBACK");
          return reply
            .code(409)
            .send({ error: "A view session is already active" });
        }
        // Trusted personal access skips the local Allow only when the computer itself said so, for
        // the desktop, and (for control) only when it allowed control.
        const access = await client.query<{
          mode: string;
          allow_control: boolean;
          version: number;
        }>(
          "SELECT mode,allow_control,version FROM machine_access WHERE machine_id=$1",
          [parsed.data.id],
        );
        const policy = access.rows[0];
        const byPolicy =
          policy?.mode === "trusted" &&
          body.data.source === "desktop" &&
          (body.data.capability === "desktop:view" || policy.allow_control);
        const session: Session = {
          id: randomUUID(),
          account_id: account,
          machine_id: parsed.data.id,
          source: body.data.source,
          capability: body.data.capability,
          expires_at: new Date(
            Date.now() + (config.SESSION_MAX_HOURS ?? 12) * 3_600_000,
          ),
          created_at: new Date(),
          status: "requested",
          approval: byPolicy ? "policy" : "local",
          policy_version: byPolicy ? policy.version : null,
        };
        await client.query(
          "INSERT INTO view_sessions(id,account_id,machine_id,source,token_hash,expires_at,status,capability,approval,policy_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            session.id,
            account,
            session.machine_id,
            session.source,
            digest(token(session)),
            session.expires_at,
            session.status,
            session.capability,
            session.approval,
            session.policy_version,
          ],
        );
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
          [
            account,
            session.machine_id,
            `${session.capability === "desktop:control" ? "desktop.control" : "desktop.view"}.requested:${session.source}`,
          ],
        );
        await client.query("COMMIT");
        wake(session.machine_id);
        return {
          id: session.id,
          source: session.source,
          capability: session.capability,
          expiresAtMillis: expiryMillis(session),
          iceServers: sessionIce(session),
          iceTransportPolicy,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
  app.post("/api/sessions/:id/stop", async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    const parsed = params.safeParse(request.params);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid session" });
    const session = await pool.query(
      "SELECT id FROM view_sessions WHERE id=$1 AND account_id=$2",
      [parsed.data.id, account],
    );
    if (!session.rowCount)
      return reply.code(404).send({ error: "Session unavailable" });
    await finish(parsed.data.id);
    return { ok: true };
  });

  // Only the original browser login can recover an ongoing local approval.
  // Nothing persisted here can revive an ended session or a restarted helper.
  app.post("/api/sessions/:id/resume", async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const parsed = params.safeParse(request.params);
    if (!enabled || !parsed.success)
      return reply.code(403).send({ error: "Session unavailable" });
    const entry = entries.get(parsed.data.id);
    if (
      !entry?.resumable ||
      entry.closed ||
      entry.machine?.readyState !== 1 ||
      entry.viewerTokenHash !== browserHash(request) ||
      !entry.detachedUntil ||
      performance.now() >= entry.detachedUntil
    )
      return reply.code(403).send({ error: "Session unavailable" });
    const result = await pool.query<Session>(
      `SELECT s.* FROM view_sessions s JOIN machines m ON m.id=s.machine_id WHERE s.id=$1 AND s.account_id=$2 AND s.status='active' AND ${liveDuration("s")} AND m.revoked_at IS NULL`,
      [parsed.data.id, account],
    );
    const session = result.rows[0];
    if (
      !session ||
      entry.closed ||
      entries.get(session.id) !== entry ||
      !entry.detachedUntil ||
      performance.now() >= entry.detachedUntil
    )
      return reply.code(403).send({ error: "Session unavailable" });
    return {
      id: session.id,
      source: session.source,
      capability: session.capability,
      expiresAtMillis: expiryMillis(session),
      iceServers: sessionIce(session),
      iceTransportPolicy,
    };
  });

  // Reissuance never extends the existing session or relay credential deadline.
  app.post(
    "/api/sessions/:id/relay",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (request.headers.origin !== config.WEB_ORIGIN)
        return reply.code(403).send({ error: "Origin rejected" });
      const account = await owner(request);
      if (!account) return reply.code(401).send({ error: "Sign in required" });
      const parsed = params.safeParse(request.params);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid session" });
      if (!enabled || !config.TURN_URLS || !config.TURN_SECRET)
        return reply.code(503).send({ error: "Relay unavailable" });
      const result = await pool.query<Session>(
        `SELECT s.* FROM view_sessions s JOIN machines m
         ON m.id=s.machine_id AND m.account_id=s.account_id
         WHERE s.id=$1 AND s.account_id=$2 AND s.expires_at>now()+interval '1 second'
         AND s.status IN ('requested','connecting','active') AND m.revoked_at IS NULL`,
        [parsed.data.id, account],
      );
      const session = result.rows[0];
      if (
        !session ||
        !session.expires_at ||
        (session.capability === "desktop:control" && !controlEnabled)
      )
        return reply.code(404).send({ error: "Session unavailable" });
      const { expiresAtMillis, ...server } = relayCredentials(
        config,
        session.id,
        relayExpiry(session.expires_at),
      );
      return { iceServers: [server], expiresAtMillis };
    },
  );

  app.route({
    method: "GET",
    url: "/api/sessions/:id/signal",
    preValidation: async (request, reply) => {
      const parsed = params.safeParse(request.params);
      const query = z
        .object({ role: z.enum(["viewer", "machine"]) })
        .strict()
        .safeParse(request.query);
      if (!enabled || !parsed.success || !query.success)
        return reply.code(403).send({ error: "Session unavailable" });
      if (request.headers.upgrade?.toLowerCase() !== "websocket")
        return reply.code(426).send({ error: "WebSocket required" });
      const result = await pool.query<Session>(
        `SELECT s.* FROM view_sessions s JOIN machines m ON m.id=s.machine_id WHERE s.id=$1 AND ${liveDuration("s")} AND s.status IN ('requested','connecting','active') AND m.revoked_at IS NULL`,
        [parsed.data.id],
      );
      const session = result.rows[0];
      if (
        !session ||
        (session.capability === "desktop:control" && !controlEnabled)
      )
        return reply.code(403).send({ error: "Session unavailable" });
      if (query.data.role === "viewer") {
        if (
          request.headers.origin !== config.WEB_ORIGIN ||
          (await owner(request)) !== session.account_id ||
          entries.get(session.id)?.viewer ||
          (entries.get(session.id)?.generation ?? 0) >= 16 ||
          (entries.get(session.id)?.viewerTokenHash !== undefined &&
            entries.get(session.id)?.viewerTokenHash !==
              browserHash(request)) ||
          (entries.get(session.id)?.detachedUntil !== undefined &&
            performance.now() >= entries.get(session.id)!.detachedUntil!)
        )
          return reply.code(403).send({ error: "Session unavailable" });
      } else {
        const bearer = request.headers.authorization?.match(
          /^Bearer ([A-Za-z0-9_-]{43})$/,
        )?.[1];
        if (!bearer)
          return reply.code(403).send({ error: "Session unavailable" });
        const claimed = await pool.query(
          `UPDATE view_sessions s SET status='connecting' WHERE id=$1 AND token_hash=$2 AND status='requested' AND ${liveDuration("s")} AND EXISTS (SELECT 1 FROM machines m WHERE m.id=s.machine_id AND m.revoked_at IS NULL) RETURNING id`,
          [session.id, digest(bearer)],
        );
        if (!claimed.rowCount)
          return reply.code(403).send({ error: "Session unavailable" });
      }
      authorized.set(request, { session, role: query.data.role, request });
    },
    handler: (_request, reply) =>
      reply.code(426).send({ error: "WebSocket required" }),
    wsHandler: (socket, request) => {
      const auth = authorized.get(request);
      if (!auth) {
        socket.close(1008);
        return;
      }
      const { session, role } = auth;
      let entry = entries.get(session.id);
      if (!entry) {
        entry = {
          closed: false,
          serial: Promise.resolve(),
          frames: 0,
          frameWindow: performance.now(),
          pendingFrames: 0,
          generation: 0,
          reconnectMs: reconnectSeconds(session) * 1000,
        };
        const live = entry;
        let checking = false;
        entry.timer = setInterval(() => {
          if (checking || live.closed) return;
          checking = true;
          void (async () => {
            const valid = await pool.query(
              `SELECT 1 FROM view_sessions s JOIN machines m ON m.id=s.machine_id WHERE s.id=$1 AND ${liveDuration("s")} AND s.status IN ('requested','connecting','active') AND m.revoked_at IS NULL`,
              [session.id],
            );
            const viewer = live.viewer;
            if (viewer && viewer.readyState !== 1 && live.resumable)
              detachViewer(live, viewer);
            if (
              !valid.rowCount ||
              (live.viewer && live.viewer.readyState !== 1) ||
              (live.detachedUntil !== undefined &&
                performance.now() >= live.detachedUntil)
            ) {
              await finish(session.id);
              return;
            }
            if (live.viewerRequest) {
              const viewerAuth = live.viewerRequest;
              if (
                !viewerAuth ||
                (await owner(viewerAuth)) !== session.account_id
              ) {
                await finish(session.id);
                return;
              }
            }
          })()
            .catch(() => finish(session.id).catch(() => {}))
            .finally(() => {
              checking = false;
            });
        }, 1000);
        entry.timer.unref();
        entries.set(session.id, entry);
      }
      if (entry[role]) {
        socket.close(1008);
        return;
      }
      entry[role] = socket;
      const resuming = role === "viewer" && entry.detachedUntil !== undefined;
      if (role === "viewer") {
        if (resuming) entry.generation += 1;
        entry.viewerRequest = request;
        entry.viewerTokenHash = browserHash(request);
        entry.detachedUntil = undefined;
        (
          socket as WebSocket & { accountRequest?: FastifyRequest }
        ).accountRequest = request;
      }
      const live = entry;
      // Short relay credentials are re-issued inside lease replies, so a long session can always
      // rebuild its peer. The lease is already authenticated and checked on every renewal.
      const leaseReply = (nonce: string) => ({
        type: "lease",
        nonce,
        maxAgeMs: 3000,
        expiresAtMillis: expiryMillis(session),
        ...(config.TURN_URLS &&
        (!live.relayRefreshAt || performance.now() >= live.relayRefreshAt)
          ? {
              iceServers:
                ((live.relayRefreshAt = performance.now() + 600_000),
                sessionIce(session)),
            }
          : {}),
      });
      // Attach synchronously: upgrade clients may send immediately.
      socket.on("message", (data, binary) => {
        if (live.closed) return;
        if (performance.now() - live.frameWindow >= 60000) {
          live.frames = 0;
          live.frameWindow = performance.now();
        }
        if (
          binary ||
          ++live.frames > 256 ||
          data.toString().length > 65536 ||
          ++live.pendingFrames > 256
        ) {
          void finish(session.id);
          return;
        }
        live.serial = live.serial
          .then(async () => {
            if (live.closed) return;
            if (role === "viewer" && live.viewer !== socket) return;
            const current = await pool.query(
              `SELECT s.status FROM view_sessions s JOIN machines m ON m.id=s.machine_id WHERE s.id=$1 AND ${liveDuration("s")} AND s.status IN ('requested','connecting','active') AND m.revoked_at IS NULL`,
              [session.id],
            );
            if (
              !current.rowCount ||
              (role === "viewer" &&
                (await owner(request)) !== session.account_id)
            ) {
              await finish(session.id);
              return;
            }
            const message = signal.safeParse(JSON.parse(data.toString()));
            if (!message.success) {
              await finish(session.id);
              return;
            }
            const body = message.data;
            if (
              (body.type === "offer" ||
                body.type === "answer" ||
                body.type === "candidate" ||
                body.type === "retry") &&
              (body.generation ?? 0) !== live.generation
            )
              return;
            if (body.type === "renew") {
              const viewer = live.viewer as
                (WebSocket & { accountRequest?: FastifyRequest }) | undefined;
              if (role !== "machine" || current.rows[0].status !== "active") {
                await finish(session.id);
                return;
              }
              if (!viewer) {
                if (
                  !live.resumable ||
                  !live.detachedUntil ||
                  performance.now() >= live.detachedUntil ||
                  !live.viewerRequest ||
                  (await owner(live.viewerRequest)) !== session.account_id
                ) {
                  await finish(session.id);
                  return;
                }
                send(socket, leaseReply(body.nonce));
                return;
              }
              if (
                viewer.readyState !== 1 ||
                !viewer.accountRequest ||
                (await owner(viewer.accountRequest)) !== session.account_id
              ) {
                await finish(session.id);
                return;
              }
              send(socket, leaseReply(body.nonce));
              return;
            }
            if (body.type === "stop") {
              await finish(session.id);
              return;
            }
            if (body.type === "consent") {
              if (role !== "machine") {
                await finish(session.id);
                return;
              }
              const consent = await pool.query(
                `WITH transitioned AS (
                  UPDATE view_sessions s SET status=$2
                  WHERE id=$1 AND status='connecting' AND ${liveDuration("s")}
                  AND EXISTS (SELECT 1 FROM machines m WHERE m.id=s.machine_id AND m.revoked_at IS NULL)
                  RETURNING account_id,machine_id
                )
                INSERT INTO audit_events(account_id,machine_id,action)
                SELECT account_id,machine_id,$3 FROM transitioned RETURNING id`,
                [
                  session.id,
                  body.accepted ? "active" : "denied",
                  body.accepted
                    ? session.capability === "desktop:control"
                      ? "desktop.control.accepted"
                      : "desktop.view.accepted"
                    : session.capability === "desktop:control"
                      ? "desktop.control.denied"
                      : "desktop.view.denied",
                ],
              );
              if (!consent.rowCount) {
                await finish(session.id);
                return;
              }
              live.resumable = body.accepted && body.resumable === true;
              send(live.viewer, {
                type: "consent",
                accepted: body.accepted,
                ...(live.resumable ? { resumable: true } : {}),
              });
              if (!body.accepted) await finish(session.id, "denied");
              return;
            }
            if (
              (body.type === "offer" && role !== "machine") ||
              (body.type === "retry" &&
                (role !== "machine" || !live.resumable)) ||
              (body.type === "answer" && role !== "viewer")
            ) {
              await finish(session.id);
              return;
            }
            if (current.rows[0].status !== "active") {
              await finish(session.id);
              return;
            }
            send(role === "viewer" ? live.machine : live.viewer, body);
          })
          .catch(() => finish(session.id).catch(() => {}))
          .finally(() => {
            live.pendingFrames--;
          });
      });
      socket.on("close", () => {
        if (
          role === "viewer" &&
          live.resumable &&
          !live.closed &&
          live.viewer === socket
        ) {
          // A short transport-recovery window, bounded by original approval.
          detachViewer(live, socket);
        } else if (role !== "viewer" || live.viewer === socket) {
          void finish(session.id).catch(() => {});
        }
      });
      socket.on("error", () => {
        void finish(session.id).catch(() => {});
      });
      send(socket, {
        type: "joined",
        role,
        source: session.source,
        capability: session.capability,
        generation: live.generation,
      });
      if (resuming) {
        send(socket, { type: "consent", accepted: true, resumable: true });
        send(live.machine, {
          type: "viewer-resumed",
          generation: live.generation,
        });
      }
    },
  });
  app.addHook("onClose", async () => {
    await Promise.allSettled([...entries.keys()].map((id) => finish(id)));
  });
  async function pending(
    machineId: string,
    options?: { wait: boolean; handled?: string; signal: AbortSignal },
  ) {
    if (!enabled) return [];
    async function load() {
      const result = await pool.query<Session & { controller: string }>(
        `SELECT s.*,a.email AS controller FROM view_sessions s JOIN accounts a ON a.id=s.account_id JOIN machines m ON m.id=s.machine_id WHERE s.machine_id=$1 AND m.revoked_at IS NULL AND s.status='requested' AND ${liveDuration("s", 1)} AND s.created_at>now()-interval '119 seconds' ORDER BY s.created_at LIMIT 1`,
        [machineId],
      );
      return result.rows
        .filter((session) => session.id !== options?.handled)
        .map((session) => ({
          id: session.id,
          token: token(session),
          controller: session.controller,
          source: session.source,
          capability: session.capability,
          expiresAtMillis: expiryMillis(session),
          approval: session.approval,
          approvalExpiresAtMillis: session.created_at.getTime() + 120000,
          reconnectSeconds: reconnectSeconds(session),
          iceServers: sessionIce(session),
          iceTransportPolicy,
        }));
    }
    // Register before reading so a commit between the read and wait is not lost.
    const waiting =
      options?.wait && !closing
        ? waitForRequest(machineId, options.signal)
        : undefined;
    try {
      const grants = await load();
      if (grants.length || !waiting || options?.signal.aborted) return grants;
      await waiting.promise;
      if (options?.signal.aborted) return [];
      // Always re-read authorization/state; notification itself grants nothing.
      return await load();
    } finally {
      waiting?.finish();
    }
  }
  return { pending, wake, enabled };
}
