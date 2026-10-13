import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import type { Config } from "./config.js";

// Two-step sign-in with an authenticator app (RFC 6238) and one-time recovery codes (ADR 0025).
// The secret is stored encrypted under a key derived from SESSION_SECRET, so a copy of the
// database alone does not reveal it.
const STEP_SECONDS = 30;
const CHALLENGE_SECONDS = 300;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function totp(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const binary =
    ((mac[offset]! & 127) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type Row = {
  secret: Buffer;
  enabled_at: Date | null;
  last_step: string | null;
  failures: number;
  locked_until: Date | null;
  recovery: string[];
};

export function registerMfa(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  owner: (request: FastifyRequest) => Promise<string | null>,
  sameOrigin: (request: FastifyRequest) => boolean,
  startSession: (accountId: string) => Promise<string>,
  setSessionCookie: (reply: FastifyReply, token: string) => void,
) {
  const master = config.SESSION_SECRET;
  const key = master
    ? Buffer.from(
        hkdfSync(
          "sha256",
          Buffer.from(master, "hex"),
          "",
          "beacon-remote-mfa",
          32,
        ),
      )
    : null;
  const seal = (secret: Buffer) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key!, iv);
    const body = Buffer.concat([cipher.update(secret), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const open = (stored: Buffer) => {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key!,
      stored.subarray(0, 12),
    );
    decipher.setAuthTag(stored.subarray(12, 28));
    return Buffer.concat([
      decipher.update(stored.subarray(28)),
      decipher.final(),
    ]);
  };
  const sign = (text: string) =>
    createHmac("sha256", key!).update(`challenge:${text}`).digest("base64url");
  const challengeFor = (account: string) => {
    const expires = Math.floor(Date.now() / 1000) + CHALLENGE_SECONDS;
    const text = `${account}.${expires}`;
    return `${text}.${sign(text)}`;
  };
  const accountOf = (challenge: string) => {
    const [account, expires, signature] = challenge.split(".");
    if (!account || !expires || !signature) return null;
    if (!sameText(signature, sign(`${account}.${expires}`))) return null;
    return Number(expires) > Date.now() / 1000 ? account : null;
  };
  const enabled = async (account: string) =>
    Boolean(
      (
        await pool.query(
          "SELECT 1 FROM account_mfa WHERE account_id=$1 AND enabled_at IS NOT NULL",
          [account],
        )
      ).rowCount,
    );
  const recoveryCodes = () =>
    Array.from({ length: 10 }, () => {
      const raw = Array.from({ length: 10 }, () =>
        "abcdefghjkmnpqrstuvwxyz23456789".charAt(randomInt(31)),
      ).join("");
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });

  // Checks a six-digit code (each time step usable once) or a recovery code (usable once).
  async function check(account: string, code: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<Row>(
        "SELECT secret,enabled_at,last_step,failures,locked_until,recovery FROM account_mfa WHERE account_id=$1 FOR UPDATE",
        [account],
      );
      const row = found.rows[0];
      if (!row || (row.locked_until && row.locked_until > new Date())) {
        await client.query("ROLLBACK");
        return false;
      }
      const secret = open(row.secret);
      let ok = false;
      let step = Number(row.last_step ?? -1);
      const normalized = code.trim().toLowerCase();
      if (/^[0-9]{6}$/.test(normalized)) {
        const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
        for (const candidate of [now - 1, now, now + 1]) {
          if (
            candidate > step &&
            sameText(totp(secret, candidate), normalized)
          ) {
            ok = true;
            step = candidate;
            break;
          }
        }
      } else if (/^[a-z0-9]{5}-[a-z0-9]{5}$/.test(normalized)) {
        const hashed = digest(normalized);
        if (row.recovery.includes(hashed)) {
          ok = true;
          await client.query(
            "UPDATE account_mfa SET recovery=array_remove(recovery,$2) WHERE account_id=$1",
            [account, hashed],
          );
        }
      }
      if (ok) {
        await client.query(
          "UPDATE account_mfa SET last_step=$2,failures=0,locked_until=NULL WHERE account_id=$1",
          [account, step],
        );
      } else {
        await client.query(
          `UPDATE account_mfa SET
             locked_until=CASE WHEN failures+1>=${MAX_FAILURES} THEN now()+interval '${LOCK_MINUTES} minutes' ELSE locked_until END,
             failures=CASE WHEN failures+1>=${MAX_FAILURES} THEN 0 ELSE failures+1 END
           WHERE account_id=$1`,
          [account],
        );
      }
      await client.query("COMMIT");
      return ok;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const limit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  const unavailable = (reply: {
    code: (n: number) => { send: (b: unknown) => unknown };
  }) => reply.code(503).send({ error: "Two-step sign-in is unavailable" });

  app.get("/api/mfa", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    return {
      available: Boolean(key),
      enabled: key ? await enabled(account) : false,
    };
  });

  app.post("/api/mfa/setup", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    if (!key) return unavailable(reply);
    if (await enabled(account))
      return reply.code(409).send({ error: "Two-step sign-in is already on" });
    const secret = randomBytes(20);
    await pool.query(
      `INSERT INTO account_mfa(account_id,secret) VALUES ($1,$2)
       ON CONFLICT (account_id) DO UPDATE SET secret=$2,enabled_at=NULL,last_step=NULL,failures=0,locked_until=NULL,recovery='{}'`,
      [account, seal(secret)],
    );
    const email = (
      await pool.query<{ email: string }>(
        "SELECT email FROM accounts WHERE id=$1",
        [account],
      )
    ).rows[0]!.email;
    const text = base32(secret);
    return {
      secret: text,
      otpauthUrl: `otpauth://totp/Beacon%20Remote:${encodeURIComponent(email)}?secret=${text}&issuer=Beacon%20Remote`,
    };
  });

  app.post("/api/mfa/enable", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    if (!key) return unavailable(reply);
    const body = z
      .object({ code: z.string().regex(/^[0-9]{6}$/) })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid code" });
    const pending = await pool.query(
      "SELECT 1 FROM account_mfa WHERE account_id=$1 AND enabled_at IS NULL",
      [account],
    );
    if (!pending.rowCount)
      return reply.code(409).send({ error: "Start setup first" });
    if (!(await check(account, body.data.code)))
      return reply.code(401).send({ error: "That code did not work" });
    const codes = recoveryCodes();
    await pool.query(
      "UPDATE account_mfa SET enabled_at=now(),recovery=$2 WHERE account_id=$1",
      [account, codes.map(digest)],
    );
    // Other browsers signed in before this must sign in again with the second step.
    await pool.query(
      "DELETE FROM browser_sessions WHERE account_id=$1 AND token_hash<>$2",
      [account, digest(request.cookies.remote_session ?? "")],
    );
    return { ok: true, recoveryCodes: codes };
  });

  app.post("/api/mfa/disable", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    if (!key) return unavailable(reply);
    const body = z
      .object({
        password: z.string().min(1).max(512),
        code: z.string().min(6).max(16),
      })
      .strict()
      .safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "Invalid request" });
    const row = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM accounts WHERE id=$1",
      [account],
    );
    if (
      !row.rowCount ||
      !(await verify(row.rows[0]!.password_hash, body.data.password)) ||
      !(await check(account, body.data.code))
    )
      return reply.code(401).send({ error: "Password or code did not work" });
    await pool.query("DELETE FROM account_mfa WHERE account_id=$1", [account]);
    return { ok: true };
  });

  app.post("/api/login/mfa", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    if (!key) return unavailable(reply);
    const body = z
      .object({
        challenge: z.string().max(200),
        code: z.string().min(6).max(16),
      })
      .strict()
      .safeParse(request.body);
    const account = body.success ? accountOf(body.data.challenge) : null;
    if (!body.success || !account || !(await check(account, body.data.code)))
      return reply.code(401).send({ error: "Invalid login" });
    setSessionCookie(reply, await startSession(account));
    return { ok: true };
  });

  return { enabled, challengeFor, available: Boolean(key) };
}
