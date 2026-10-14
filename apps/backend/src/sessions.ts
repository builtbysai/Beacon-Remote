import { createHash, createHmac, randomUUID } from "node:crypto";
import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Config } from "./config.js";
import {
  displayInfo,
  supportCode,
} from "../../../packages/protocol/src/index.js";
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
  display_id: string | null;
  relationship_id: string | null;
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
// Peers replaced within one session (each reconnect is one). Generous: a long session on a poor
// network reconnects often, and each one is bounded by the lease and the reconnect window.
const MAX_GENERATIONS = 1024;
// A computer can be shared with a bounded number of helpers at once.
const MAX_HELPERS_PER_MACHINE = 20;
const RECONNECT_TRUSTED_MS = 300_000;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const params = z.object({ id: z.uuid() });
const signal = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("retry"),
      generation: z.number().int().min(0).max(MAX_GENERATIONS),
    })
    .strict(),
  z
    .object({
      type: z.literal("offer"),
      sdp: z.string().min(1).max(32768),
      generation: z.number().int().min(0).max(MAX_GENERATIONS).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("answer"),
      sdp: z.string().min(1).max(32768),
      generation: z.number().int().min(0).max(MAX_GENERATIONS).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("candidate"),
      candidate: z.string().max(2048),
      sdpMid: z.string().max(32).nullable(),
      sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
      generation: z.number().int().min(0).max(MAX_GENERATIONS).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("consent"),
      accepted: z.boolean(),
      resumable: z.boolean().optional(),
      // False when the person at the computer approved viewing but not the control that was asked for.
      control: z.boolean().optional(),
    })
    .strict(),
  // The person at the computer paused or resumed sharing; the viewer is told so it can say why the
  // picture stopped.
  z.object({ type: z.literal("paused"), paused: z.boolean() }).strict(),
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
  guests?: {
    create(client: PoolClient): Promise<{ account: string; token: string }>;
    setCookie(reply: FastifyReply, token: string): void;
  },
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
    return `(${alias}.expires_at>now()+interval '${seconds} seconds' AND (${alias}.status='active' OR ${alias}.created_at>now()-interval '120 seconds') AND (${alias}.approval='local' OR EXISTS (SELECT 1 FROM machine_access pa WHERE pa.machine_id=${alias}.machine_id AND pa.version=${alias}.policy_version AND CASE WHEN ${alias}.relationship_id IS NULL THEN pa.mode='trusted' AND (${alias}.capability<>'desktop:control' OR pa.allow_control) ELSE pa.helpers_unattended='control' OR (pa.helpers_unattended='view' AND ${alias}.capability='desktop:view') END))) AND (${alias}.relationship_id IS NULL OR EXISTS (SELECT 1 FROM support_relationships rr WHERE rr.id=${alias}.relationship_id AND rr.revoked_at IS NULL AND rr.expires_at>now()))`;
  }
  // Clients are told 0, meaning no fixed expiry: the cap is enforced here and the lease is the clock.
  const expiryMillis = () => 0;
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
       s.created_at AS "createdAt", s.expires_at AS "expiresAt",
       CASE WHEN s.account_id<>$1 THEN (SELECT CASE WHEN guest_expires_at IS NOT NULL THEN 'Guest helper (no account)' ELSE email END FROM accounts WHERE id=s.account_id) END AS "controller",
       (SELECT jsonb_build_object(
          'samples', count(*),
          'route', mode() WITHIN GROUP (ORDER BY q.route),
          'height', max(q.height),
          'fps', round(avg(q.fps)::numeric,0),
          'rttMs', round(avg(q.rtt_ms)::numeric,0),
          'rttP95Ms', round((percentile_cont(0.95) WITHIN GROUP (ORDER BY q.rtt_ms))::numeric,0),
          'lossPct', round(avg(q.loss_pct)::numeric,1))
        FROM session_quality q WHERE q.session_id=s.id HAVING count(*)>0) AS "quality"
       FROM view_sessions s JOIN machines m ON m.id=s.machine_id
       WHERE (s.account_id=$1 OR m.account_id=$1) AND ($2::uuid IS NULL OR s.machine_id=$2)
       ORDER BY s.created_at DESC,s.id LIMIT 100`,
      [account, query.data.machineId ?? null],
    );
    return { available: true, sessions: result.rows };
  });
  // The viewer reports a few measured numbers every so often while a session runs. Only the session's own
  // viewer may add them, at most one sample every eight seconds and a bounded number per session.
  app.post(
    "/api/sessions/:id/quality",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (request.headers.origin !== config.WEB_ORIGIN)
        return reply.code(403).send({ error: "Origin rejected" });
      const account = await owner(request);
      if (!account) return reply.code(401).send({ error: "Sign in required" });
      const path = z.object({ id: z.uuid() }).safeParse(request.params);
      const sample = z
        .object({
          route: z.enum(["Direct", "Relayed", "Unavailable"]),
          height: z.number().int().min(0).max(4320).nullable(),
          fps: z.number().min(0).max(240).nullable(),
          rttMs: z.number().min(0).max(60000).nullable(),
          lossPct: z.number().min(0).max(100).nullable(),
        })
        .strict()
        .safeParse(request.body);
      if (!path.success || !sample.success)
        return reply.code(400).send({ error: "Invalid sample" });
      const inserted = await pool.query(
        `INSERT INTO session_quality(session_id,route,height,fps,rtt_ms,loss_pct)
         SELECT s.id,$3,$4,$5,$6,$7 FROM view_sessions s
         WHERE s.id=$1 AND s.account_id=$2 AND s.status IN ('connecting','active')
           AND NOT EXISTS (SELECT 1 FROM session_quality q WHERE q.session_id=s.id AND q.sampled_at>now()-interval '8 seconds')
           AND (SELECT count(*) FROM session_quality q WHERE q.session_id=s.id)<600`,
        [
          path.data.id,
          account,
          sample.data.route,
          sample.data.height,
          sample.data.fps,
          sample.data.rttMs,
          sample.data.lossPct,
        ],
      );
      return reply.code(inserted.rowCount ? 204 : 202).send();
    },
  );
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
        `beacon-remote:view:v1\n${session.id}\n${session.machine_id}\n${session.source}\n${expiryMillis()}${session.capability === "desktop:control" ? "\ndesktop:control" : ""}`,
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
  // Creates the session row inside the caller's transaction (machine already locked and checked).
  // A support session never relies on the computer's trusted-access policy: it always needs the
  // local Allow, because that policy is about the owner's own account.
  async function openSession(
    client: PoolClient,
    input: {
      account: string;
      machineId: string;
      source: "desktop" | "synthetic";
      capability: "desktop:view" | "desktop:control";
      displayId: string | null;
      support: boolean;
      relationshipId?: string;
    },
  ): Promise<Session | "busy"> {
    await client.query(
      `UPDATE view_sessions s SET status='ended' WHERE machine_id=$1 AND NOT ${liveDuration("s")} AND status IN ('requested','connecting','active')`,
      [input.machineId],
    );
    const busy = await client.query(
      "SELECT 1 FROM view_sessions WHERE machine_id=$1 AND status IN ('requested','connecting','active')",
      [input.machineId],
    );
    if (busy.rowCount) return "busy";
    // Trusted personal access skips the local Allow only when the computer itself said so, for
    // the desktop, and (for control) only when it allowed control.
    const access = await client.query<{
      mode: string;
      allow_control: boolean;
      version: number;
      helpers_unattended: string;
    }>(
      "SELECT mode,allow_control,version,helpers_unattended FROM machine_access WHERE machine_id=$1",
      [input.machineId],
    );
    const policy = access.rows[0];
    // A one-time support code always needs the local Allow. A remembered helper skips it only when
    // the computer itself said so, at a level that covers what was asked.
    const byPolicy =
      input.source === "desktop" &&
      (input.relationshipId
        ? policy?.helpers_unattended === "control" ||
          (policy?.helpers_unattended === "view" &&
            input.capability === "desktop:view")
        : !input.support &&
          policy?.mode === "trusted" &&
          (input.capability === "desktop:view" || policy.allow_control));
    const session: Session = {
      id: randomUUID(),
      account_id: input.account,
      machine_id: input.machineId,
      source: input.source,
      capability: input.capability,
      expires_at: new Date(
        Date.now() + (config.SESSION_MAX_HOURS ?? 12) * 3_600_000,
      ),
      created_at: new Date(),
      status: "requested",
      approval: byPolicy ? "policy" : "local",
      policy_version: byPolicy ? policy!.version : null,
      display_id: input.displayId,
      relationship_id: input.relationshipId ?? null,
    };
    await client.query(
      "INSERT INTO view_sessions(id,account_id,machine_id,source,token_hash,expires_at,status,capability,approval,policy_version,display_id,relationship_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        session.id,
        input.account,
        session.machine_id,
        session.source,
        digest(token(session)),
        session.expires_at,
        session.status,
        session.capability,
        session.approval,
        session.policy_version,
        session.display_id,
        session.relationship_id,
      ],
    );
    const action = `${session.capability === "desktop:control" ? "desktop.control" : "desktop.view"}.requested:${session.source}`;
    await client.query(
      "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
      [input.account, session.machine_id, action],
    );
    // The computer's owner sees a helper's or team member's request in their own activity, with who made it.
    await client.query(
      `INSERT INTO audit_events(account_id,machine_id,action,actor_account_id)
       SELECT m.account_id,m.id,$2,$3 FROM machines m WHERE m.id=$1 AND m.account_id<>$3`,
      [session.machine_id, action, input.account],
    );
    return session;
  }
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
          displayId: displayInfo.shape.id.optional(),
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
          "SELECT id,displays,(SELECT capability FROM support_links WHERE id=support_link_id) AS link_capability FROM machines WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND last_seen_at>now()-interval '45 seconds' FOR UPDATE",
          [parsed.data.id, account],
        );
        if (!machine.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Computer unavailable" });
        }
        // A temporary support computer never goes beyond what its link offered.
        if (
          body.data.capability === "desktop:control" &&
          machine.rows[0].link_capability === "desktop:view"
        ) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Control unavailable" });
        }
        // Only a display the computer itself reported can be chosen.
        const known = machine.rows[0].displays as { id: string }[];
        if (
          body.data.displayId &&
          (body.data.source !== "desktop" ||
            !known.some((display) => display.id === body.data.displayId))
        ) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Unknown display" });
        }
        const opened = await openSession(client, {
          account,
          machineId: parsed.data.id,
          source: body.data.source,
          capability: body.data.capability,
          displayId: body.data.displayId ?? null,
          support: false,
        });
        if (opened === "busy") {
          await client.query("ROLLBACK");
          return reply
            .code(409)
            .send({ error: "A view session is already active" });
        }
        const session = opened;
        await client.query("COMMIT");
        wake(session.machine_id);
        return {
          id: session.id,
          source: session.source,
          capability: session.capability,
          expiresAtMillis: expiryMillis(),
          approval: session.approval,
          reconnectSeconds: reconnectSeconds(session),
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
  // A helper redeems a one-time support code. The person at the computer still approves locally,
  // and nothing here leaves the helper with standing access to the computer.
  const claimSupport =
    (allowGuest: boolean) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.headers.origin !== config.WEB_ORIGIN)
        return reply.code(403).send({ error: "Origin rejected" });
      // Without an account the helper becomes a temporary guest once the code is known to be good.
      let account = await owner(request);
      if (!account && !(allowGuest && guests))
        return reply.code(401).send({ error: "Sign in required" });
      if (!enabled)
        return reply.code(503).send({ error: "View sessions disabled" });
      const body = z
        .object({ code: supportCode })
        .strict()
        .safeParse(request.body);
      // Invalid, expired, used and unknown codes are indistinguishable.
      const unavailable = () =>
        reply.code(404).send({ error: "That support code did not work" });
      if (!body.success) return unavailable();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const invitation = await client.query<{
          machine_id: string;
          capability: "desktop:view" | "desktop:control";
        }>(
          "SELECT machine_id,capability FROM support_invitations WHERE code_hash=$1 AND claimed_at IS NULL AND expires_at>now() FOR UPDATE",
          [digest(body.data.code)],
        );
        const found = invitation.rows[0];
        const machine = found
          ? await client.query<{ account_id: string; name: string }>(
              "SELECT account_id,name FROM machines WHERE id=$1 AND revoked_at IS NULL AND last_seen_at>now()-interval '45 seconds' FOR UPDATE",
              [found.machine_id],
            )
          : null;
        if (!found || !machine?.rowCount) {
          await client.query("ROLLBACK");
          return unavailable();
        }
        if (found.capability === "desktop:control" && !controlEnabled) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Control unavailable" });
        }
        let guestToken: string | null = null;
        if (!account) {
          const guest = await guests!.create(client);
          account = guest.account;
          guestToken = guest.token;
        }
        const opened = await openSession(client, {
          account,
          machineId: found.machine_id,
          source: "desktop",
          capability: found.capability,
          displayId: null,
          support: true,
        });
        if (opened === "busy") {
          await client.query("ROLLBACK");
          return reply
            .code(409)
            .send({ error: "A view session is already active" });
        }
        await client.query(
          "UPDATE support_invitations SET claimed_at=now(),claimed_by=$2 WHERE code_hash=$1",
          [digest(body.data.code), account],
        );
        // The owner's activity shows who was invited, even though the helper owns the session.
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
          [
            machine.rows[0]!.account_id,
            found.machine_id,
            `support.invitation.claimed:${found.capability === "desktop:control" ? "control" : "view"}`,
          ],
        );
        await client.query("COMMIT");
        if (guestToken) guests!.setCookie(reply, guestToken);
        wake(opened.machine_id);
        return {
          id: opened.id,
          source: opened.source,
          capability: opened.capability,
          expiresAtMillis: expiryMillis(),
          approval: opened.approval,
          reconnectSeconds: reconnectSeconds(opened),
          iceServers: sessionIce(opened),
          iceTransportPolicy,
          machineName: machine.rows[0]!.name,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
  const claimLimit = {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };
  app.post("/api/support/claim", claimLimit, claimSupport(false));
  // The same redemption for a helper with no account: they become a temporary guest (migration 012).
  app.post("/api/support/guest", claimLimit, claimSupport(true));
  // Remembered support (ADR 0024). The owner names an account; that account may then request
  // sessions on this computer until the expiry, and every session still needs the local Allow.
  const relationshipParams = z.object({ id: z.uuid() });
  app.post("/api/machines/:id/relationships", async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = params.safeParse(request.params);
    const body = z
      .object({
        email: z.email().max(254),
        capability: z.enum(["desktop:view", "desktop:control"]),
        days: z.number().int().min(1).max(90),
      })
      .strict()
      .safeParse(request.body);
    if (!path.success || !body.success)
      return reply.code(400).send({ error: "Invalid support access" });
    if (body.data.capability === "desktop:control" && !controlEnabled)
      return reply.code(403).send({ error: "Control unavailable" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const machine = await client.query(
        "SELECT id FROM machines WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL FOR UPDATE",
        [path.data.id, account],
      );
      const helper = await client.query<{ id: string }>(
        "SELECT id FROM accounts WHERE lower(email)=lower($1) AND id<>$2",
        [body.data.email, account],
      );
      if (!machine.rowCount || !helper.rowCount) {
        await client.query("ROLLBACK");
        return reply
          .code(404)
          .send({ error: "Could not share with that account" });
      }
      await client.query(
        "UPDATE support_relationships SET revoked_at=now() WHERE machine_id=$1 AND helper_account_id=$2 AND revoked_at IS NULL",
        [path.data.id, helper.rows[0]!.id],
      );
      const shared = await client.query(
        "SELECT count(*)::int AS n FROM support_relationships WHERE machine_id=$1 AND revoked_at IS NULL AND expires_at>now()",
        [path.data.id],
      );
      if (shared.rows[0].n >= MAX_HELPERS_PER_MACHINE) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Too many helpers" });
      }
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + body.data.days * 86_400_000);
      await client.query(
        "INSERT INTO support_relationships(id,machine_id,helper_account_id,capability,expires_at) VALUES ($1,$2,$3,$4,$5)",
        [id, path.data.id, helper.rows[0]!.id, body.data.capability, expiresAt],
      );
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
        [
          account,
          path.data.id,
          `support.relationship.granted:${body.data.capability === "desktop:control" ? "control" : "view"}`,
        ],
      );
      await client.query("COMMIT");
      return { id, expiresAtMillis: expiresAt.getTime() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.get("/api/machines/:id/relationships", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = params.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid computer" });
    const result = await pool.query(
      `SELECT r.id,a.email AS "helperEmail",r.capability,(r.team_member_id IS NOT NULL) AS team,
              CASE WHEN r.team_member_id IS NULL THEN (extract(epoch FROM r.expires_at)*1000)::bigint END AS "expiresAtMillis"
       FROM support_relationships r JOIN accounts a ON a.id=r.helper_account_id
       JOIN machines m ON m.id=r.machine_id
       WHERE r.machine_id=$1 AND m.account_id=$2 AND r.revoked_at IS NULL AND r.expires_at>now()
       ORDER BY r.created_at`,
      [path.data.id, account],
    );
    return {
      relationships: result.rows.map((row) => ({
        ...row,
        // Team shares have no expiry of their own.
        expiresAtMillis:
          row.expiresAtMillis === null ? null : Number(row.expiresAtMillis),
      })),
    };
  });
  app.post("/api/relationships/:id/revoke", async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = relationshipParams.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid support access" });
    // A share that comes from the team is changed in the team settings, or it would simply return.
    const managed = await pool.query(
      `SELECT 1 FROM support_relationships r JOIN machines m ON m.id=r.machine_id
       WHERE r.id=$1 AND m.account_id=$2 AND r.revoked_at IS NULL AND r.team_member_id IS NOT NULL`,
      [path.data.id, account],
    );
    if (managed.rowCount)
      return reply.code(409).send({ error: "Managed by your team" });
    const revoked = await pool.query<{ machine_id: string }>(
      `UPDATE support_relationships r SET revoked_at=now()
       FROM machines m WHERE r.id=$1 AND m.id=r.machine_id AND m.account_id=$2 AND r.revoked_at IS NULL
       RETURNING r.machine_id`,
      [path.data.id, account],
    );
    if (!revoked.rowCount)
      return reply.code(404).send({ error: "Support access unavailable" });
    await pool.query(
      "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'support.relationship.revoked')",
      [account, revoked.rows[0]!.machine_id],
    );
    // A session that relied on it ends now, not at its next renewal.
    const live = await pool.query<{ id: string }>(
      "SELECT id FROM view_sessions WHERE relationship_id=$1 AND status IN ('requested','connecting','active')",
      [path.data.id],
    );
    for (const row of live.rows) await finish(row.id);
    return { ok: true, ended: live.rowCount ?? 0 };
  });
  // What a helper can reach: computers whose owners named this account.
  app.get("/api/shared", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const result = await pool.query(
      `SELECT r.id,m.name AS "machineName",r.capability,oa.email AS "ownerEmail",(r.team_member_id IS NOT NULL) AS team,
              CASE WHEN r.team_member_id IS NULL THEN (extract(epoch FROM r.expires_at)*1000)::bigint END AS "expiresAtMillis",
              (m.last_seen_at>now()-interval '45 seconds') AS online
       FROM support_relationships r JOIN machines m ON m.id=r.machine_id JOIN accounts oa ON oa.id=m.account_id
       WHERE r.helper_account_id=$1 AND r.revoked_at IS NULL AND r.expires_at>now() AND m.revoked_at IS NULL
       ORDER BY r.created_at`,
      [account],
    );
    return {
      shared: result.rows.map((row) => ({
        ...row,
        expiresAtMillis:
          row.expiresAtMillis === null ? null : Number(row.expiresAtMillis),
      })),
    };
  });
  app.post(
    "/api/relationships/:id/sessions",
    { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (request.headers.origin !== config.WEB_ORIGIN)
        return reply.code(403).send({ error: "Origin rejected" });
      const account = await owner(request);
      if (!account) return reply.code(401).send({ error: "Sign in required" });
      if (!enabled)
        return reply.code(503).send({ error: "View sessions disabled" });
      const path = relationshipParams.safeParse(request.params);
      const body = z
        .object({
          capability: z
            .enum(["desktop:view", "desktop:control"])
            .default("desktop:view"),
        })
        .strict()
        .safeParse(request.body ?? {});
      if (!path.success || !body.success)
        return reply.code(400).send({ error: "Invalid session" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{
          machine_id: string;
          capability: string;
          machine_name: string;
        }>(
          `SELECT r.machine_id,r.capability,m.name AS machine_name FROM support_relationships r
           JOIN machines m ON m.id=r.machine_id
           WHERE r.id=$1 AND r.helper_account_id=$2 AND r.revoked_at IS NULL AND r.expires_at>now()
             AND m.revoked_at IS NULL AND m.last_seen_at>now()-interval '45 seconds'
           FOR UPDATE OF m`,
          [path.data.id, account],
        );
        const relationship = found.rows[0];
        if (!relationship) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Computer unavailable" });
        }
        // Control only if it was granted, and the server allows it.
        if (
          body.data.capability === "desktop:control" &&
          (relationship.capability !== "desktop:control" || !controlEnabled)
        ) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Control unavailable" });
        }
        const opened = await openSession(client, {
          account,
          machineId: relationship.machine_id,
          source: "desktop",
          capability: body.data.capability,
          displayId: null,
          support: true,
          relationshipId: path.data.id,
        });
        if (opened === "busy") {
          await client.query("ROLLBACK");
          return reply
            .code(409)
            .send({ error: "A view session is already active" });
        }
        await client.query("COMMIT");
        wake(opened.machine_id);
        return {
          id: opened.id,
          source: opened.source,
          capability: opened.capability,
          expiresAtMillis: expiryMillis(),
          approval: opened.approval,
          reconnectSeconds: reconnectSeconds(opened),
          iceServers: sessionIce(opened),
          iceTransportPolicy,
          machineName: relationship.machine_name,
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
    // A half-open connection can look attached long after the network dropped. The same browser
    // login replaces it; any other login is refused below because the token hash differs.
    if (
      entry?.viewer &&
      entry.resumable &&
      !entry.closed &&
      entry.viewerTokenHash === browserHash(request)
    ) {
      const stale = entry.viewer;
      detachViewer(entry, stale);
      stale.terminate();
    }
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
      expiresAtMillis: expiryMillis(),
      reconnectSeconds: reconnectSeconds(session),
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
          (entries.get(session.id)?.viewer &&
            (!entries.get(session.id)?.resumable ||
              entries.get(session.id)?.viewerTokenHash !==
                browserHash(request))) ||
          (entries.get(session.id)?.generation ?? 0) >= MAX_GENERATIONS ||
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
      if (role === "viewer" && entry.viewer && entry.resumable) {
        // Same browser, replacing a viewer that died without closing (checked before upgrade).
        const stale = entry.viewer;
        detachViewer(entry, stale);
        stale.terminate();
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
        expiresAtMillis: expiryMillis(),
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
                ),
                mine AS (
                  INSERT INTO audit_events(account_id,machine_id,action)
                  SELECT account_id,machine_id,$3 FROM transitioned RETURNING id
                ),
                owners AS (
                  INSERT INTO audit_events(account_id,machine_id,action,actor_account_id)
                  SELECT m.account_id,t.machine_id,$3,t.account_id
                  FROM transitioned t JOIN machines m ON m.id=t.machine_id WHERE m.account_id<>t.account_id
                  RETURNING id
                )
                SELECT id FROM mine`,
                [
                  session.id,
                  body.accepted ? "active" : "denied",
                  body.accepted
                    ? session.capability === "desktop:control" &&
                      body.control !== false
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
                ...(body.control === false ? { control: false } : {}),
              });
              if (!body.accepted) await finish(session.id, "denied");
              return;
            }
            if (
              (body.type === "offer" && role !== "machine") ||
              (body.type === "paused" && role !== "machine") ||
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
        `SELECT s.*,CASE WHEN a.guest_expires_at IS NOT NULL THEN 'Guest helper (no account)' ELSE a.email END AS controller FROM view_sessions s JOIN accounts a ON a.id=s.account_id JOIN machines m ON m.id=s.machine_id WHERE s.machine_id=$1 AND m.revoked_at IS NULL AND s.status='requested' AND ${liveDuration("s", 1)} AND s.created_at>now()-interval '119 seconds' ORDER BY s.created_at LIMIT 1`,
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
          expiresAtMillis: expiryMillis(),
          approval: session.approval,
          displayId: session.display_id,
          viaRelationship: session.relationship_id !== null,
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
  // Ends sessions that relied on shares that were just revoked.
  async function endRelationshipSessions(relationships: string[]) {
    if (!relationships.length) return;
    const live = await pool.query<{ id: string }>(
      "SELECT id FROM view_sessions WHERE relationship_id=ANY($1::uuid[]) AND status IN ('requested','connecting','active')",
      [relationships],
    );
    for (const row of live.rows) await finish(row.id);
  }
  // Ends every live session on one computer, for a computer that was just revoked or finished.
  async function endMachineSessions(machineId: string) {
    const live = await pool.query<{ id: string }>(
      "SELECT id FROM view_sessions WHERE machine_id=$1 AND status IN ('requested','connecting','active')",
      [machineId],
    );
    for (const row of live.rows) await finish(row.id);
  }
  return {
    pending,
    wake,
    enabled,
    endRelationshipSessions,
    endMachineSessions,
  };
}
