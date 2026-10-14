import {
  createHash,
  createPublicKey,
  randomBytes,
  randomInt,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import type { Pool } from "pg";
// Relative import compiles into the same deployment tree; no runtime TS loader.
import {
  accessMessage,
  accessRequest,
  enrollment,
  heartbeat,
  heartbeatMessage,
  helpersMessage,
  helpersRequest,
  SUPPORT_CODE_ALPHABET,
  supportMessage,
  supportRequest,
} from "../../../packages/protocol/src/index.js";
import type { Config } from "./config.js";
import { registerSessions } from "./sessions.js";
import { registerAccountData } from "./account-data.js";
import { registerTeam, syncTeam } from "./team.js";
import { registerMfa } from "./mfa.js";
import { createMailer, type Mailer } from "./mail.js";
import { registerSignup } from "./signup.js";

// A support code is typed by hand, so it is short-lived and single-use.
const SUPPORT_CODE_MINUTES = 15;
// Bounds on what one account can pile up, beyond the per-route rate limits.
const MAX_PENDING_ENROLLMENTS = 10;
const MAX_MACHINES = 50;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const login = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(512) })
  .strict();

export async function createApp(
  pool: Pool,
  config: Config,
  options: { mailer?: Mailer | null } = {},
) {
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
    // Only the explicitly configured private proxy network may forward client IPs.
    trustProxy: config.TRUST_PROXY_CIDR ?? false,
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

  async function browserSession(
    request: FastifyRequest,
  ): Promise<{ account: string; guest: boolean } | null> {
    const token = request.cookies.remote_session;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await pool.query<{ account_id: string; guest: boolean }>(
      `SELECT b.account_id,(a.guest_expires_at IS NOT NULL) AS guest
       FROM browser_sessions b JOIN accounts a ON a.id=b.account_id
       WHERE b.token_hash=$1 AND b.expires_at>now()`,
      [digest(token)],
    );
    const row = result.rows[0];
    return row ? { account: row.account_id, guest: row.guest } : null;
  }
  // The signed-in account. A guest (a helper who redeemed a support code without an account) is not one.
  async function owner(request: FastifyRequest): Promise<string | null> {
    const session = await browserSession(request);
    return session && !session.guest ? session.account : null;
  }
  // Accounts and guests alike: only support-session routes accept a guest.
  async function accountOrGuest(request: FastifyRequest) {
    return (await browserSession(request))?.account ?? null;
  }
  const GUEST_HOURS = 4;
  const guests = {
    hours: GUEST_HOURS,
    async create(client: { query: Pool["query"] }) {
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      await client.query(
        "INSERT INTO accounts(id,email,password_hash,guest_expires_at) VALUES ($1,$2,'!',now()+make_interval(hours=>$3))",
        [id, `guest-${id}@guest.invalid`, GUEST_HOURS],
      );
      await client.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+make_interval(hours=>$3))",
        [digest(token), id, GUEST_HOURS],
      );
      return { account: id, token };
    },
    setCookie(reply: FastifyReply, token: string) {
      reply.setCookie("remote_session", token, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: GUEST_HOURS * 3600,
      });
    },
  };
  // Expired guests, their sessions and history go away with their account.
  const purgeGuests = () =>
    void pool
      .query("DELETE FROM accounts WHERE guest_expires_at<now()")
      .catch(() => undefined);
  purgeGuests();
  const purgeTimer = setInterval(purgeGuests, 10 * 60 * 1000);
  purgeTimer.unref();
  app.addHook("onClose", async () => clearInterval(purgeTimer));
  function sameOrigin(request: FastifyRequest) {
    return request.headers.origin === config.WEB_ORIGIN;
  }
  // True only when the signature is by the enrolled, unrevoked computer's own key.
  async function signedByMachine(
    machineId: string,
    message: string,
    signature: string,
  ): Promise<boolean> {
    const result = await pool.query<{ public_key: Buffer }>(
      "SELECT public_key FROM machines WHERE id=$1 AND revoked_at IS NULL",
      [machineId],
    );
    const rawKey = result.rows[0]?.public_key;
    if (!rawKey) return false;
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        rawKey,
      ]),
      type: "spki",
      format: "der",
    });
    return verifySignature(
      null,
      Buffer.from(message),
      key,
      Buffer.from(signature, "base64"),
    );
  }
  async function startSession(accountId: string) {
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '8 hours')",
      [digest(token), accountId],
    );
    return token;
  }
  function setSessionCookie(reply: FastifyReply, token: string) {
    reply.setCookie("remote_session", token, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 3600,
    });
  }
  registerSignup(
    app,
    pool,
    config,
    options.mailer === undefined ? createMailer(config) : options.mailer,
    sameOrigin,
    startSession,
    setSessionCookie,
  );
  const mfa = registerMfa(
    app,
    pool,
    config,
    owner,
    sameOrigin,
    startSession,
    setSessionCookie,
  );
  registerAccountData(app, pool, owner, sameOrigin, mfa, (reply) =>
    reply.clearCookie("remote_session", { path: "/" }),
  );
  const sessionRequests = await registerSessions(
    app,
    pool,
    config,
    accountOrGuest,
    guests,
  );

  registerTeam(
    app,
    pool,
    owner,
    sameOrigin,
    sessionRequests.endRelationshipSessions,
  );

  app.get("/health", async () => ({ status: "ok", service: "beacon-remote" }));
  app.get("/ready", async () => {
    await pool.query("SELECT 1 FROM machines LIMIT 1");
    return { status: "ok" };
  });

  app.post(
    "/api/account/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!sameOrigin(request))
        return reply.code(403).send({ error: "Origin rejected" });
      const parsed = login
        .extend({
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          password: z.string().min(16).max(512),
        })
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid account setup" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const invitation = await client.query(
          "UPDATE account_invitations SET claimed_at=now() WHERE token_hash=$1 AND claimed_at IS NULL AND expires_at>now() RETURNING token_hash",
          [digest(parsed.data.token)],
        );
        if (invitation.rowCount !== 1) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Invitation unavailable" });
        }
        await client.query(
          "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
          [
            randomUUID(),
            parsed.data.email.toLowerCase(),
            await hash(parsed.data.password),
          ],
        );
        await client.query("COMMIT");
        return { ok: true };
      } catch (failure) {
        await client.query("ROLLBACK");
        if (
          failure &&
          typeof failure === "object" &&
          "code" in failure &&
          failure.code === "23505"
        )
          return reply.code(400).send({ error: "Account setup unavailable" });
        throw failure;
      } finally {
        client.release();
      }
    },
  );

  // Operator-issued one-time link: sets a new password, signs out every browser, and leaves
  // two-step sign-in in place (an operator removes that separately when the authenticator is lost).
  app.post(
    "/api/account/recover",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!sameOrigin(request))
        return reply.code(403).send({ error: "Origin rejected" });
      const parsed = z
        .object({
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          password: z.string().min(16).max(512),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid recovery" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query<{ account_id: string }>(
          "UPDATE account_recoveries SET claimed_at=now() WHERE token_hash=$1 AND claimed_at IS NULL AND expires_at>now() RETURNING account_id",
          [digest(parsed.data.token)],
        );
        if (!claimed.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Recovery link unavailable" });
        }
        const accountId = claimed.rows[0]!.account_id;
        await client.query("UPDATE accounts SET password_hash=$2 WHERE id=$1", [
          accountId,
          await hash(parsed.data.password),
        ]);
        await client.query("DELETE FROM browser_sessions WHERE account_id=$1", [
          accountId,
        ]);
        await client.query("COMMIT");
        return { ok: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    "/api/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!sameOrigin(request))
        return reply.code(403).send({ error: "Origin rejected" });
      const parsed = login.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid login" });
      const result = await pool.query<{
        id: string;
        password_hash: string;
        email_verified: boolean;
      }>(
        "SELECT id,password_hash,email_verified FROM accounts WHERE email=$1 AND guest_expires_at IS NULL",
        [parsed.data.email.toLowerCase()],
      );
      const account = result.rows[0];
      const valid = await verify(
        account?.password_hash ?? dummyHash,
        parsed.data.password,
      );
      if (!valid || !account)
        return reply.code(401).send({ error: "Invalid login" });
      // Only after the right password is it said that the address still needs confirming.
      if (!account.email_verified)
        return reply
          .code(403)
          .send({ error: "Confirm your email first", unverified: true });
      // With two-step sign-in on, the password alone starts nothing: the browser gets a short-lived
      // challenge and must present a code before any session exists.
      if (mfa.available && (await mfa.enabled(account.id)))
        return { mfaRequired: true, challenge: mfa.challengeFor(account.id) };
      setSessionCookie(reply, await startSession(account.id));
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
      `SELECT m.id,m.name,m.group_name AS "group",m.last_seen_at AS "lastSeenAt",m.revoked_at AS "revokedAt",
       COALESCE((m.revoked_at IS NULL AND m.last_seen_at>now()-interval '45 seconds'),false) AS online,
       COALESCE(a.mode,'attended') AS "accessMode",COALESCE(a.allow_control,false) AS "allowControl",COALESCE(a.helpers_unattended,'off') AS "helpersUnattended",m.displays
       FROM machines m LEFT JOIN machine_access a ON a.machine_id=m.id
       WHERE m.account_id=$1 ORDER BY m.created_at`,
      [account],
    );
    return { machines: result.rows };
  });

  app.get("/api/account/sessions", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const result = await pool.query(
      `SELECT expires_at AS "expiresAt", token_hash=$2 AS current
       FROM browser_sessions WHERE account_id=$1 AND expires_at>now()
       ORDER BY expires_at DESC LIMIT 100`,
      [account, digest(request.cookies.remote_session!)],
    );
    return { sessions: result.rows };
  });

  app.post("/api/machines/:id/name", async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = z.object({ id: z.uuid() }).safeParse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        // Omitted leaves the group alone; null or an empty string clears it.
        group: z.string().trim().max(40).nullable().optional(),
      })
      .strict()
      .safeParse(request.body);
    if (!path.success || !body.success)
      return reply.code(400).send({ error: "Invalid computer name" });
    const setGroup = body.data.group !== undefined;
    const result = await pool.query(
      `WITH renamed AS (UPDATE machines SET name=$3,group_name=CASE WHEN $4 THEN NULLIF($5,'') ELSE group_name END
         WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL RETURNING id)
       INSERT INTO audit_events(account_id,machine_id,action) SELECT $2,id,'machine.renamed' FROM renamed RETURNING machine_id`,
      [
        path.data.id,
        account,
        body.data.name,
        setGroup,
        body.data.group ?? null,
      ],
    );
    if (result.rowCount !== 1)
      return reply.code(404).send({ error: "Computer unavailable" });
    // A group change can move the computer in or out of a team's scope.
    if (setGroup)
      await sessionRequests.endRelationshipSessions(
        await syncTeam(pool, account),
      );
    return { ok: true };
  });

  app.post("/api/account/sessions/end-others", async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    await pool.query(
      "DELETE FROM browser_sessions WHERE account_id=$1 AND token_hash<>$2",
      [account, digest(request.cookies.remote_session!)],
    );
    return { ok: true };
  });

  app.get("/api/activity", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const query = z
      .object({ machineId: z.uuid().optional() })
      .strict()
      .safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: "Invalid activity filter" });
    const result = await pool.query(
      `SELECT a.id::text, a.action, a.occurred_at AS "occurredAt", m.name AS "machineName",
              CASE WHEN ac.guest_expires_at IS NOT NULL THEN 'Guest helper (no account)' ELSE ac.email END AS "actor"
       FROM audit_events a LEFT JOIN machines m ON m.id=a.machine_id AND m.account_id=a.account_id
       LEFT JOIN accounts ac ON ac.id=a.actor_account_id
       WHERE a.account_id=$1 AND ($2::uuid IS NULL OR a.machine_id=$2)
       ORDER BY a.occurred_at DESC,a.id DESC LIMIT 100`,
      [account, query.data.machineId ?? null],
    );
    return { events: result.rows };
  });

  app.post(
    "/api/enrollments",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!sameOrigin(request))
        return reply.code(403).send({ error: "Origin rejected" });
      const account = await owner(request);
      if (!account) return reply.code(401).send({ error: "Sign in required" });
      const pending = await pool.query(
        "SELECT count(*)::int AS n FROM enrollments WHERE account_id=$1 AND claimed_at IS NULL AND expires_at>now()",
        [account],
      );
      if (pending.rows[0].n >= MAX_PENDING_ENROLLMENTS)
        return reply.code(429).send({ error: "Too many pending codes" });
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
        const owned = await client.query(
          "SELECT count(*)::int AS n FROM machines WHERE account_id=$1 AND revoked_at IS NULL",
          [account],
        );
        if (owned.rows[0].n >= MAX_MACHINES) {
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
        // A new computer joins the teams whose scope covers it.
        await syncTeam(client, account);
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
    const query = z
      .object({ wait: z.literal("1").optional(), handled: z.uuid().optional() })
      .strict()
      .safeParse(request.query);
    if (!query.success || (query.data.handled && !query.data.wait))
      return reply.code(400).send({ error: "Invalid heartbeat options" });
    const parsed = heartbeat.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid heartbeat" });
    const body = parsed.data;
    if (Math.abs(Date.now() - body.timestamp) > 30_000)
      return reply.code(401).send({ error: "Heartbeat rejected" });
    if (
      !(await signedByMachine(
        body.machineId,
        heartbeatMessage(body.machineId, body.timestamp, body.nonce),
        body.signature,
      ))
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
      await client.query(
        "UPDATE machines SET last_seen_at=now(),displays=COALESCE($2::jsonb,displays) WHERE id=$1",
        [body.machineId, body.displays ? JSON.stringify(body.displays) : null],
      );
      // Keep nonces longer than the signed timestamp acceptance window.
      await client.query(
        "DELETE FROM heartbeat_nonces WHERE machine_id=$1 AND received_at<now()-interval '2 minutes'",
        [body.machineId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const aborted = new AbortController();
    const disconnect = () => aborted.abort();
    reply.raw.once("close", disconnect);
    try {
      const wait = query.data.wait === "1" && sessionRequests.enabled;
      // Wait for a request first, then read the policy, so the answer is current: a long wait must
      // not hand the computer a policy from before it changed its own setting.
      const sessions = await sessionRequests.pending(body.machineId, {
        wait,
        handled: query.data.handled,
        signal: aborted.signal,
      });
      const policy = await pool.query<{
        mode: string;
        allow_control: boolean;
        version: number;
        helpers_unattended: string;
      }>(
        "SELECT mode,allow_control,version,helpers_unattended FROM machine_access WHERE machine_id=$1",
        [body.machineId],
      );
      return {
        ok: true,
        version: 1,
        // The computer follows a lowering done from the web; it never raises itself from this.
        access: {
          mode: policy.rows[0]?.mode ?? "attended",
          allowControl: policy.rows[0]?.allow_control ?? false,
          helpers: policy.rows[0]?.helpers_unattended ?? "off",
          version: policy.rows[0]?.version ?? 0,
        },
        pollAfterMillis: wait ? 0 : 15000,
        sessions,
      };
    } finally {
      reply.raw.removeListener("close", disconnect);
    }
  });

  // The computer raises or lowers its own policy, signed with its identity key. This is the only
  // way a computer becomes reachable without a local Allow (ADR 0021).
  app.post(
    "/api/agent/access",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = accessRequest.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid access request" });
      const body = parsed.data;
      if (Math.abs(Date.now() - body.timestamp) > 30_000)
        return reply.code(401).send({ error: "Access request rejected" });
      if (
        !(await signedByMachine(
          body.machineId,
          accessMessage(
            body.machineId,
            body.timestamp,
            body.nonce,
            body.mode,
            body.allowControl,
          ),
          body.signature,
        ))
      )
        return reply.code(401).send({ error: "Access request rejected" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const machine = await client.query<{ account_id: string }>(
          "SELECT account_id FROM machines WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
          [body.machineId],
        );
        if (!machine.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(401).send({ error: "Access request rejected" });
        }
        const nonce = await client.query(
          "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
          [body.machineId, body.nonce],
        );
        if (!nonce.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Access request rejected" });
        }
        const saved = await client.query<{ version: number }>(
          `INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,$2,$3)
           ON CONFLICT (machine_id) DO UPDATE SET mode=$2,allow_control=$3,updated_at=now(),
             version=CASE WHEN machine_access.mode=$2 AND machine_access.allow_control=$3
               THEN machine_access.version ELSE machine_access.version+1 END
           RETURNING version`,
          [body.machineId, body.mode, body.allowControl],
        );
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
          [
            machine.rows[0]!.account_id,
            body.machineId,
            body.mode === "trusted"
              ? body.allowControl
                ? "machine.access.trusted-control"
                : "machine.access.trusted-view"
              : "machine.access.attended",
          ],
        );
        await client.query("COMMIT");
        return {
          ok: true,
          access: {
            mode: body.mode,
            allowControl: body.allowControl,
            version: saved.rows[0]!.version,
          },
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  // The person at the computer asks for a one-time support code, signed with its identity key.
  // The code is shown only on that computer; it expires, works once and replaces any earlier one.
  app.post(
    "/api/agent/support",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = supportRequest.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid support request" });
      const body = parsed.data;
      if (Math.abs(Date.now() - body.timestamp) > 30_000)
        return reply.code(401).send({ error: "Support request rejected" });
      if (
        !(await signedByMachine(
          body.machineId,
          supportMessage(
            body.machineId,
            body.timestamp,
            body.nonce,
            body.capability,
          ),
          body.signature,
        ))
      )
        return reply.code(401).send({ error: "Support request rejected" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const machine = await client.query<{ account_id: string }>(
          "SELECT account_id FROM machines WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
          [body.machineId],
        );
        if (!machine.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(401).send({ error: "Support request rejected" });
        }
        const nonce = await client.query(
          "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
          [body.machineId, body.nonce],
        );
        if (!nonce.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Support request rejected" });
        }
        if (body.capability === "desktop:control" && !config.CONTROL_ENABLED) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Control unavailable" });
        }
        await client.query(
          "DELETE FROM support_invitations WHERE machine_id=$1 AND claimed_at IS NULL",
          [body.machineId],
        );
        const code = Array.from(
          { length: 8 },
          () => SUPPORT_CODE_ALPHABET[randomInt(SUPPORT_CODE_ALPHABET.length)],
        ).join("");
        const expiresAt = new Date(Date.now() + SUPPORT_CODE_MINUTES * 60_000);
        await client.query(
          "INSERT INTO support_invitations(code_hash,machine_id,capability,expires_at) VALUES ($1,$2,$3,$4)",
          [digest(code), body.machineId, body.capability, expiresAt],
        );
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
          [
            machine.rows[0]!.account_id,
            body.machineId,
            `support.invitation.created:${body.capability === "desktop:control" ? "control" : "view"}`,
          ],
        );
        await client.query("COMMIT");
        return {
          ok: true,
          code: `${code.slice(0, 4)}-${code.slice(4)}`,
          capability: body.capability,
          expiresAtMillis: expiresAt.getTime(),
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  // The computer decides whether people the owner remembered may connect without the local Allow.
  // Like trusted access, it is raised only here, signed with the computer's key (ADR 0027).
  app.post(
    "/api/agent/helpers",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = helpersRequest.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid helpers request" });
      const body = parsed.data;
      if (Math.abs(Date.now() - body.timestamp) > 30_000)
        return reply.code(401).send({ error: "Helpers request rejected" });
      if (
        !(await signedByMachine(
          body.machineId,
          helpersMessage(
            body.machineId,
            body.timestamp,
            body.nonce,
            body.level,
          ),
          body.signature,
        ))
      )
        return reply.code(401).send({ error: "Helpers request rejected" });
      if (body.level === "control" && config.CONTROL_ENABLED !== "true")
        return reply.code(403).send({ error: "Control unavailable" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const machine = await client.query<{ account_id: string }>(
          "SELECT account_id FROM machines WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
          [body.machineId],
        );
        if (!machine.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(401).send({ error: "Helpers request rejected" });
        }
        const nonce = await client.query(
          "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
          [body.machineId, body.nonce],
        );
        if (!nonce.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Helpers request rejected" });
        }
        const saved = await client.query<{ version: number }>(
          `INSERT INTO machine_access(machine_id,helpers_unattended) VALUES ($1,$2)
           ON CONFLICT (machine_id) DO UPDATE SET helpers_unattended=$2,updated_at=now(),
             version=CASE WHEN machine_access.helpers_unattended=$2
               THEN machine_access.version ELSE machine_access.version+1 END
           RETURNING version`,
          [body.machineId, body.level],
        );
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
          [
            machine.rows[0]!.account_id,
            body.machineId,
            `machine.helpers.${body.level}`,
          ],
        );
        await client.query("COMMIT");
        return { ok: true, level: body.level, version: saved.rows[0]!.version };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  // The signed-in owner can always lower a computer's access. Raising it needs the computer.
  app.post("/api/machines/:id/access", async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = z.object({ id: z.uuid() }).safeParse(request.params);
    const body = z
      .union([
        z.object({ mode: z.literal("attended") }).strict(),
        z.object({ allowControl: z.literal(false) }).strict(),
        z.object({ helpers: z.enum(["off", "view"]) }).strict(),
      ])
      .safeParse(request.body);
    if (!path.success || !body.success)
      return reply.code(400).send({ error: "Invalid access change" });
    if ("helpers" in body.data) {
      // Lowering how much remembered helpers may do without asking; a session that relied on the
      // old level ends with the version bump.
      const to = body.data.helpers;
      const lowered = await pool.query(
        `WITH lowered AS (
           UPDATE machine_access a SET helpers_unattended=$3,updated_at=now(),version=a.version+1
           FROM machines m WHERE a.machine_id=m.id AND m.id=$1 AND m.account_id=$2 AND m.revoked_at IS NULL
             AND ((a.helpers_unattended='control') OR (a.helpers_unattended='view' AND $3='off'))
           RETURNING m.id)
         INSERT INTO audit_events(account_id,machine_id,action)
         SELECT $2,id,'machine.helpers.'||$3 FROM lowered RETURNING machine_id`,
        [path.data.id, account, to],
      );
      return { ok: true, changed: (lowered.rowCount ?? 0) > 0 };
    }
    const attended = "mode" in body.data;
    const result = await pool.query(
      `WITH lowered AS (
         UPDATE machine_access a SET
           mode=CASE WHEN $3 THEN 'attended' ELSE a.mode END,
           allow_control=false,updated_at=now(),version=a.version+1
         FROM machines m WHERE a.machine_id=m.id AND m.id=$1 AND m.account_id=$2 AND m.revoked_at IS NULL
           AND (a.mode<>'attended' OR a.allow_control)
         RETURNING m.id)
       INSERT INTO audit_events(account_id,machine_id,action)
       SELECT $2,id,CASE WHEN $3 THEN 'machine.access.attended' ELSE 'machine.access.control-off' END FROM lowered RETURNING machine_id`,
      [path.data.id, account, attended],
    );
    // Nothing to lower is still a success: the computer is already at or below that level.
    return { ok: true, changed: (result.rowCount ?? 0) > 0 };
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
    sessionRequests.wake(id.data.id);
    await sessionRequests.endRelationshipSessions(
      await syncTeam(pool, account),
    );
    return { ok: true };
  });
  return app;
}
