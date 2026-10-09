import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import type { Pool } from "pg";
// Relative import compiles into the same deployment tree; no runtime TS loader.
import {
  enrollment,
  heartbeat,
  heartbeatMessage,
} from "../../../packages/protocol/src/index.js";
import type { Config } from "./config.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const login = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(512) })
  .strict();

export async function createApp(pool: Pool, config: Config) {
  const app = Fastify({
    bodyLimit: 4096,
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              'res.headers["set-cookie"]',
            ],
          },
    // Do not trust arbitrary forwarded IPs. Proxy configuration comes with deploy.
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  const dummyHash = await hash(randomBytes(32).toString("base64url"));
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  // Request bodies, keys, codes, password hashes and signatures never enter logs.
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    reply
      .code(status)
      .send({ error: status === 429 ? "Too many requests" : "Request failed" });
  });

  async function owner(request: FastifyRequest): Promise<string | null> {
    const token = request.cookies.remote_session;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await pool.query<{ account_id: string }>(
      "SELECT account_id FROM browser_sessions WHERE token_hash=$1 AND expires_at>now()",
      [digest(token)],
    );
    return result.rows[0]?.account_id ?? null;
  }
  function sameOrigin(request: FastifyRequest) {
    return request.headers.origin === config.WEB_ORIGIN;
  }

  app.get("/health", async () => ({ status: "ok", service: "beacon-remote" }));
  app.get("/ready", async () => {
    await pool.query("SELECT 1 FROM machines LIMIT 1");
    return { status: "ok" };
  });

  app.post(
    "/api/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!sameOrigin(request))
        return reply.code(403).send({ error: "Origin rejected" });
      const parsed = login.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid login" });
      const result = await pool.query<{ id: string; password_hash: string }>(
        "SELECT id,password_hash FROM accounts WHERE email=$1",
        [parsed.data.email.toLowerCase()],
      );
      const account = result.rows[0];
      const valid = await verify(
        account?.password_hash ?? dummyHash,
        parsed.data.password,
      );
      if (!valid || !account)
        return reply.code(401).send({ error: "Invalid login" });
      const token = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '8 hours')",
        [digest(token), account.id],
      );
      reply.setCookie("remote_session", token, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
      return { ok: true };
    },
  );

  app.post("/api/logout", async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    if (request.cookies.remote_session)
      await pool.query("DELETE FROM browser_sessions WHERE token_hash=$1", [
        digest(request.cookies.remote_session),
      ]);
    reply.clearCookie("remote_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/machines", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const result = await pool.query(
      `SELECT id,name,last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt",
       COALESCE((revoked_at IS NULL AND last_seen_at>now()-interval '45 seconds'),false) AS online
       FROM machines WHERE account_id=$1 ORDER BY created_at`,
      [account],
    );
    return { machines: result.rows };
  });

  app.post(
    "/api/enrollments",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!sameOrigin(request))
        return reply.code(403).send({ error: "Origin rejected" });
      const account = await owner(request);
      if (!account) return reply.code(401).send({ error: "Sign in required" });
      const code = randomBytes(24).toString("base64url");
      await pool.query(
        "INSERT INTO enrollments VALUES ($1,$2,now()+interval '5 minutes',NULL)",
        [digest(code), account],
      );
      return { code, expiresInSeconds: 300, version: 1 };
    },
  );

  app.post(
    "/api/agent/enroll",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = enrollment.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid enrollment" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<{ account_id: string }>(
          `UPDATE enrollments SET claimed_at=now()
         WHERE code_hash=$1 AND claimed_at IS NULL AND expires_at>now() RETURNING account_id`,
          [digest(parsed.data.code)],
        );
        const account = result.rows[0]?.account_id;
        if (!account) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Enrollment unavailable" });
        }
        const id = randomUUID();
        await client.query(
          "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,$3,$4)",
          [
            id,
            account,
            parsed.data.name,
            Buffer.from(parsed.data.publicKey, "base64"),
          ],
        );
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
          [account, id, "machine.enrolled"],
        );
        await client.query("COMMIT");
        return { version: 1, machineId: id, heartbeatIntervalSeconds: 15 };
      } catch {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Enrollment unavailable" });
      } finally {
        client.release();
      }
    },
  );

  app.post("/api/agent/heartbeat", async (request, reply) => {
    const parsed = heartbeat.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid heartbeat" });
    const body = parsed.data;
    if (Math.abs(Date.now() - body.timestamp) > 30_000)
      return reply.code(401).send({ error: "Heartbeat rejected" });
    const result = await pool.query<{ public_key: Buffer }>(
      "SELECT public_key FROM machines WHERE id=$1 AND revoked_at IS NULL",
      [body.machineId],
    );
    const rawKey = result.rows[0]?.public_key;
    if (!rawKey) return reply.code(401).send({ error: "Heartbeat rejected" });
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        rawKey,
      ]),
      type: "spki",
      format: "der",
    });
    if (
      !verifySignature(
        null,
        Buffer.from(
          heartbeatMessage(body.machineId, body.timestamp, body.nonce),
        ),
        key,
        Buffer.from(body.signature, "base64"),
      )
    ) {
      return reply.code(401).send({ error: "Heartbeat rejected" });
    }
    // Row lock serializes heartbeat and revocation. A replay cannot refresh presence.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const active = await client.query(
        "SELECT id FROM machines WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
        [body.machineId],
      );
      if (!active.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Heartbeat rejected" });
      }
      const nonce = await client.query(
        "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [body.machineId, body.nonce],
      );
      if (!nonce.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Heartbeat rejected" });
      }
      await client.query("UPDATE machines SET last_seen_at=now() WHERE id=$1", [
        body.machineId,
      ]);
      // Keep nonces longer than the signed timestamp acceptance window.
      await client.query(
        "DELETE FROM heartbeat_nonces WHERE machine_id=$1 AND received_at<now()-interval '2 minutes'",
        [body.machineId],
      );
      await client.query("COMMIT");
      return { ok: true, version: 1 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/machines/:id/revoke", async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const id = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!id.success) return reply.code(400).send({ error: "Invalid machine" });
    const result = await pool.query(
      `WITH revoked AS (UPDATE machines SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND account_id=$2 RETURNING id)
       INSERT INTO audit_events(account_id,machine_id,action) SELECT $2,id,'machine.revoked' FROM revoked RETURNING machine_id`,
      [id.data.id, account],
    );
    if (!result.rowCount)
      return reply.code(404).send({ error: "Machine unavailable" });
    return { ok: true };
  });
  return app;
}
