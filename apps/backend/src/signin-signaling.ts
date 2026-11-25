// Sign-in signaling only. No pixels, input, launch requests or lease renewal.
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { WebSocket } from "ws";
import { z } from "zod";
import {
  signinWorkerConnectProof,
  signinWorkerConnectMessage,
} from "../../../packages/protocol/src/index.js";
import type { Config } from "./config.js";
import { relayCredentials } from "./relay.js";
import {
  signinLiveLease,
  signinLeaseJoins,
  signinValidSignature,
  consumeSigninNonce,
} from "./signin-shared.js";

type Role = "viewer" | "worker";
type Context = {
  id: string;
  account_id: string;
  machine_id: string;
  browser_token_hash: string;
  instance_id: string;
  console_session_id: string;
  worker_public_key: Buffer;
  remaining: number;
  relay_deadline: Date;
};
type Entry = {
  context: Context;
  viewer?: WebSocket;
  worker?: WebSocket;
  closed: boolean;
  deadline: number;
  waitingUntil: number;
  timer?: ReturnType<typeof setInterval>;
  serial: Promise<void>;
  checking: boolean;
  pending: number;
  pendingBytes: number;
  frames: number;
  frameWindow: number;
  stage: "waiting" | "offered" | "answered";
  ending?: Promise<void>;
  tombstone?: ReturnType<typeof setTimeout>;
  lastPing: number;
  lastPong: Partial<Record<Role, number>>;
  announced: Partial<Record<Role, boolean>>;
  paired: boolean;
};
const queryContext = `SELECT s.id,s.account_id,s.machine_id,s.browser_token_hash,s.instance_id,s.console_session_id,e.worker_public_key,
  GREATEST(0,FLOOR(EXTRACT(epoch FROM (LEAST(s.expires_at,s.deadline,b.expires_at,e.last_seen_at+interval '15 seconds')-now()))*1000))::int AS remaining,
  LEAST(s.deadline,b.expires_at) AS relay_deadline
  ${signinLeaseJoins} WHERE s.id=$1 AND ${signinLiveLease} AND e.worker_public_key IS NOT NULL`;
const signals = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("offer"), sdp: z.string().min(1).max(32768) })
    .strict(),
  z
    .object({ type: z.literal("answer"), sdp: z.string().min(1).max(32768) })
    .strict(),
  z
    .object({
      type: z.literal("candidate"),
      candidate: z.string().max(2048),
      sdpMid: z.string().max(32).nullable(),
      sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
    })
    .strict(),
  z.object({ type: z.literal("stop") }).strict(),
]);
function workerProof(header: string | undefined) {
  const encoded = header?.match(/^Beacon-SignIn ([A-Za-z0-9_-]{1,3072})$/)?.[1];
  if (!encoded) return null;
  const body = Buffer.from(encoded, "base64url");
  if (body.length > 2048 || body.toString("base64url") !== encoded) return null;
  try {
    const parsed = signinWorkerConnectProof.safeParse(
      JSON.parse(body.toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function closeSocket(socket: WebSocket | undefined) {
  if (!socket) return;
  // Also cover a rejected post-upgrade race before role handlers were attached.
  socket.on("error", () => {});
  socket.close(1000, "Sign-in ended");
  const timer = setTimeout(() => socket.terminate(), 250);
  timer.unref();
}
export function registerSigninSignaling(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  owner: (request: FastifyRequest) => Promise<string | null>,
  enabled: boolean,
) {
  const entries = new Map<string, Entry>();
  const authorized = new WeakMap<
    FastifyRequest,
    { context: Context; role: Role; deadline: number }
  >();
  let closing = false;
  function finish(id: string): Promise<void> {
    const entry = entries.get(id);
    if (!entry) return Promise.resolve();
    if (entry.ending) return entry.ending;
    if (entry.closed) return Promise.resolve();
    entry.closed = true;
    clearInterval(entry.timer);
    closeSocket(entry.viewer);
    closeSocket(entry.worker);
    entry.ending = (async () => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query(
          "BEGIN; SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='2s'",
        );
        await client.query("SELECT id FROM machines WHERE id=$1 FOR UPDATE", [
          entry.context.machine_id,
        ]);
        await client.query(
          `WITH ended AS (
        UPDATE signin_leases SET ended_at=now(),ended_reason='transport' WHERE id=$1 AND ended_at IS NULL RETURNING account_id,machine_id
      ), disarmed AS (
        UPDATE signin_endpoints SET worker_ready=false WHERE machine_id=$2 AND instance_id=$3 AND console_session_id=$4 AND worker_public_key=$5
      ) INSERT INTO audit_events(account_id,machine_id,action)
        SELECT account_id,machine_id,'signin.transport.ended' FROM ended`,
          [
            id,
            entry.context.machine_id,
            entry.context.instance_id,
            entry.context.console_session_id,
            entry.context.worker_public_key,
          ],
        );
        await client.query("COMMIT");
        if (entries.get(id) === entry) entries.delete(id);
      } catch {
        await client?.query("ROLLBACK").catch(() => {});
        // Closed sockets stay closed even if persistence/audit fails. Retain a
        // bounded tombstone so this process cannot re-admit the old reservation.
        app.log.error("Sign-in signaling termination persistence failed");
        entry.tombstone = setTimeout(() => {
          if (entries.get(id) === entry) entries.delete(id);
        }, 300_000);
        entry.tombstone.unref();
      } finally {
        client?.release();
      }
    })();
    return entry.ending;
  }
  function send(id: string, socket: WebSocket | undefined, body: unknown) {
    const entry = entries.get(id);
    if (!entry || entry.closed) return;
    if (performance.now() >= entry.deadline) {
      void finish(id);
      return;
    }
    if (!socket || socket.readyState !== 1) return;
    const text = JSON.stringify(body);
    if (socket.bufferedAmount > 65536 || Buffer.byteLength(text) > 65536) {
      void finish(id);
      return;
    }
    socket.send(text, (error) => {
      if (error) void finish(id);
    });
  }
  async function refresh(entry: Entry) {
    const started = performance.now();
    const current = (
      await pool.query<Context>(queryContext, [entry.context.id])
    ).rows[0];
    if (entry.closed) return false;
    if (
      !current ||
      current.remaining <= 0 ||
      current.account_id !== entry.context.account_id ||
      current.browser_token_hash !== entry.context.browser_token_hash ||
      current.machine_id !== entry.context.machine_id ||
      current.instance_id !== entry.context.instance_id ||
      current.console_session_id !== entry.context.console_session_id ||
      !current.worker_public_key.equals(entry.context.worker_public_key)
    ) {
      await finish(entry.context.id);
      return false;
    }
    entry.deadline = started + Math.min(15000, current.remaining);
    if (performance.now() >= entry.deadline) {
      await finish(entry.context.id);
      return false;
    }
    return true;
  }
  function ready(entry: Entry, socket: WebSocket) {
    const context = entry.context;
    const iceServers: {
      urls: string[];
      username?: string;
      credential?: string;
    }[] = [{ urls: [config.STUN_URL ?? "stun:129.213.128.206:3478"] }];
    if (config.TURN_URLS && config.TURN_SECRET) {
      const relay = relayCredentials(
        config,
        context.id,
        context.relay_deadline,
      );
      iceServers.push({
        urls: relay.urls,
        username: relay.username,
        credential: relay.credential,
      });
    }
    send(context.id, socket, {
      type: "ready",
      scope: "windows:sign-in",
      leaseId: context.id,
      instanceId: context.instance_id,
      consoleSessionId: Number(context.console_session_id),
      workerPublicKey: context.worker_public_key.toString("base64"),
      iceServers,
      iceTransportPolicy: config.ICE_TRANSPORT_POLICY ?? "all",
      files: false,
      clipboard: false,
      audio: false,
      recording: false,
      automation: false,
    });
  }
  app.addHook("preClose", async () => {
    closing = true;
    await Promise.allSettled([...entries.keys()].map(finish));
    for (const entry of entries.values()) {
      clearInterval(entry.timer);
      clearTimeout(entry.tombstone);
    }
    entries.clear();
  });
  app.route({
    method: "GET",
    url: "/api/signin/leases/:id/signal",
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    preValidation: async (request, reply) => {
      const params = z.object({ id: z.uuid() }).safeParse(request.params);
      const query = z
        .object({ role: z.enum(["viewer", "worker"]) })
        .strict()
        .safeParse(request.query);
      if (!enabled || closing)
        return reply.code(503).send({ error: "Sign-in signaling unavailable" });
      if (!params.success || !query.success)
        return reply.code(403).send({ error: "Sign-in signaling unavailable" });
      if (request.headers.upgrade?.toLowerCase() !== "websocket")
        return reply.code(426).send({ error: "WebSocket required" });
      if (
        entries.get(params.data.id)?.closed ||
        (entries.size >= 256 && !entries.has(params.data.id))
      )
        return reply.code(403).send({ error: "Sign-in signaling unavailable" });
      const role = query.data.role;
      const account = role === "viewer" ? await owner(request) : null;
      if (
        role === "viewer" &&
        (request.headers.origin !== config.WEB_ORIGIN ||
          request.headers.authorization ||
          !account)
      )
        return reply.code(403).send({ error: "Sign-in signaling unavailable" });
      const proof =
        role === "worker" ? workerProof(request.headers.authorization) : null;
      if (
        role === "worker" &&
        (!proof ||
          request.headers.origin !== undefined ||
          request.cookies.remote_session !== undefined ||
          proof.leaseId !== params.data.id ||
          Math.abs(Date.now() - proof.timestamp) > 30_000)
      )
        return reply.code(403).send({ error: "Sign-in signaling unavailable" });
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        const started = performance.now();
        await client.query(
          "BEGIN; SET LOCAL statement_timeout='2s'; SET LOCAL lock_timeout='1s'",
        );
        await client.query(
          "SELECT m.id FROM machines m JOIN signin_leases s ON s.machine_id=m.id WHERE s.id=$1 FOR UPDATE OF m",
          [params.data.id],
        );
        const context = (
          await client.query<Context>(
            queryContext + " FOR UPDATE OF m,e,s,b,p",
            [params.data.id],
          )
        ).rows[0];
        if (
          !context ||
          context.remaining <= 0 ||
          (role === "viewer" &&
            (account !== context.account_id ||
              createHash("sha256")
                .update(request.cookies.remote_session ?? "")
                .digest("hex") !== context.browser_token_hash)) ||
          (role === "worker" &&
            (!proof ||
              proof.machineId !== context.machine_id ||
              proof.instanceId !== context.instance_id ||
              proof.consoleSessionId !== Number(context.console_session_id) ||
              !signinValidSignature(
                context.worker_public_key,
                signinWorkerConnectMessage(proof),
                proof.signature,
              )))
        ) {
          await client.query("ROLLBACK");
          return reply
            .code(403)
            .send({ error: "Sign-in signaling unavailable" });
        }
        if (
          proof &&
          !(await consumeSigninNonce(client, proof.machineId, proof.nonce))
        ) {
          await client.query("ROLLBACK");
          return reply
            .code(409)
            .send({ error: "Sign-in signaling unavailable" });
        }
        await client.query("COMMIT");
        if (entries.get(context.id)?.[role] || entries.get(context.id)?.closed)
          return reply
            .code(409)
            .send({ error: "Sign-in signaling unavailable" });
        const deadline = started + Math.min(15000, context.remaining);
        if (performance.now() >= deadline)
          return reply
            .code(403)
            .send({ error: "Sign-in signaling unavailable" });
        authorized.set(request, { context, role, deadline });
      } catch (error) {
        await client?.query("ROLLBACK");
        throw error;
      } finally {
        client?.release();
      }
    },
    handler: (_request, reply) =>
      reply.code(426).send({ error: "WebSocket required" }),
    wsHandler: (socket, request) => {
      const auth = authorized.get(request);
      if (!auth || closing) {
        closeSocket(socket);
        return;
      }
      let entry = entries.get(auth.context.id);
      if (
        entry?.closed ||
        entry?.[auth.role] ||
        (!entry && entries.size >= 256)
      ) {
        closeSocket(socket);
        return;
      }
      if (!entry) {
        entry = {
          context: auth.context,
          closed: false,
          deadline: auth.deadline,
          waitingUntil: performance.now() + 10_000,
          serial: Promise.resolve(),
          checking: false,
          pending: 0,
          pendingBytes: 0,
          frames: 0,
          frameWindow: performance.now(),
          stage: "waiting",
          lastPing: performance.now(),
          lastPong: {},
          announced: {},
          paired: false,
        };
        entries.set(auth.context.id, entry);
        const live = entry;
        entry.timer = setInterval(() => {
          // This clock continues to close peers even if the DB read is stalled.
          if (
            performance.now() >= live.deadline ||
            (["viewer", "worker"] as const).some(
              (role) =>
                live[role] &&
                performance.now() - (live.lastPong[role] ?? 0) > 5000,
            ) ||
            ((!live.viewer || !live.worker) &&
              performance.now() >= live.waitingUntil)
          ) {
            void finish(live.context.id);
            return;
          }
          if (performance.now() - live.lastPing >= 2000) {
            live.lastPing = performance.now();
            for (const peer of [live.viewer, live.worker]) {
              if (peer?.readyState === 1)
                peer.ping(undefined, undefined, (error) => {
                  if (error) void finish(live.context.id);
                });
            }
          }
          if (live.checking || live.closed) return;
          live.checking = true;
          void refresh(live)
            .catch(() => finish(live.context.id))
            .finally(() => {
              live.checking = false;
            });
        }, 250);
        entry.timer.unref();
      }
      const live = entry;
      live[auth.role] = socket;
      live.lastPong[auth.role] = performance.now();
      socket.on("pong", () => {
        if (live[auth.role] === socket)
          live.lastPong[auth.role] = performance.now();
      });
      socket.on("close", () => {
        void finish(live.context.id);
      });
      socket.on("error", () => {
        void finish(live.context.id);
      });
      socket.on("message", (data, binary) => {
        if (live.closed) return;
        const body = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        if (performance.now() - live.frameWindow >= 60000) {
          live.frames = 0;
          live.frameWindow = performance.now();
        }
        live.pending++;
        live.pendingBytes += body.length;
        if (
          binary ||
          body.length > 65536 ||
          ++live.frames > 256 ||
          live.pending > 16 ||
          live.pendingBytes > 131072
        ) {
          void finish(live.context.id);
          return;
        }
        live.serial = live.serial
          .then(async () => {
            if (live.closed || !(await refresh(live))) return;
            const parsed = signals.safeParse(JSON.parse(body.toString("utf8")));
            if (!parsed.success) {
              await finish(live.context.id);
              return;
            }
            const signal = parsed.data;
            if (signal.type === "stop") {
              await finish(live.context.id);
              return;
            }
            if (
              !live.paired ||
              !live.viewer ||
              !live.worker ||
              (signal.type === "offer" &&
                (auth.role !== "worker" || live.stage !== "waiting")) ||
              (signal.type === "answer" &&
                (auth.role !== "viewer" || live.stage !== "offered"))
            ) {
              await finish(live.context.id);
              return;
            }
            if (signal.type === "offer") live.stage = "offered";
            if (signal.type === "answer") live.stage = "answered";
            send(
              live.context.id,
              auth.role === "worker" ? live.viewer : live.worker,
              signal,
            );
          })
          .catch(() => finish(live.context.id))
          .finally(() => {
            live.pending--;
            live.pendingBytes -= body.length;
          });
      });
      // Attach handlers synchronously, then revalidate before revealing ICE or
      // relaying any signaling. Socket arrival alone cannot start media.
      live.serial = live.serial
        .then(async () => {
          if (!(await refresh(live))) return;
          ready(live, socket);
          if (live.closed || socket.readyState !== 1) return;
          live.announced[auth.role] = true;
          if (live.announced.viewer && live.announced.worker && !live.paired) {
            live.paired = true;
            send(live.context.id, live.viewer, {
              type: "peer-ready",
              scope: "windows:sign-in",
            });
            send(live.context.id, live.worker, {
              type: "peer-ready",
              scope: "windows:sign-in",
            });
          }
        })
        .catch(() => finish(live.context.id));
    },
  });
  return {
    stopLease: finish,
    stopLeases: async (ids: string[]) => {
      // Target the leases ended by that committed transaction, so a delayed
      // callback cannot tear down a newer worker's freshly admitted lease.
      await Promise.allSettled(ids.map(finish));
    },
  };
}
