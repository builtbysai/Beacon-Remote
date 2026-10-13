// Public sign-up with an emailed confirmation link, and password recovery by email.
//
// Rules: no route says whether an address already has an account (every request answers the same);
// an account cannot sign in until its address is confirmed; links are one-time, expire, and only their
// hash is stored; everything is rate limited per address and per connection, and a daily cap protects the
// mail quota. Sign-up and email recovery stay closed unless a mailer is configured.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Mailer } from "./mail.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const email = z.string().trim().toLowerCase().email().max(254);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const VERIFY_HOURS = 24;
const RECOVERY_MINUTES = 30;
// A person who mistyped gets a fresh link; a script does not get an inbox full of them.
const RESEND_GAP_SECONDS = 120;
const PURGE_UNVERIFIED_HOURS = 48;

export function registerSignup(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  mailer: Mailer | null,
  sameOrigin: (request: FastifyRequest) => boolean,
  startSession: (accountId: string) => Promise<string>,
  setSessionCookie: (reply: FastifyReply, token: string) => void,
) {
  const open = Boolean(mailer) && config.PUBLIC_SIGNUP === "true";
  const dailyCap = config.SIGNUPS_PER_DAY ?? 100;
  const link = (fragment: string) => `${config.WEB_ORIGIN}/#${fragment}`;
  const limit = (max: number) => ({
    config: { rateLimit: { max, timeWindow: "1 hour" } },
  });
  const body = z
    .object({ email, password: z.string().min(12).max(512) })
    .strict();

  async function sendVerification(accountId: string, to: string) {
    const raw = randomBytes(32).toString("base64url");
    await pool.query("DELETE FROM email_verifications WHERE account_id=$1", [
      accountId,
    ]);
    await pool.query(
      "INSERT INTO email_verifications(token_hash,account_id,expires_at) VALUES ($1,$2,now()+make_interval(hours=>$3))",
      [digest(raw), accountId, VERIFY_HOURS],
    );
    await mailer!.send({
      to,
      subject: "Confirm your Beacon Remote account",
      text: `Confirm your email address to finish creating your Beacon Remote account:\n\n${link(`verify=${raw}`)}\n\nThe link works once and expires in ${VERIFY_HOURS} hours. If you did not sign up, you can ignore this message and nothing will be created.\n`,
    });
  }

  // Whether sign-up is open, so the page can show or hide the form.
  app.get("/api/signup/config", async () => ({
    open,
    emailRecovery: Boolean(mailer),
  }));

  app.post("/api/signup", limit(5), async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    if (!open) return reply.code(404).send({ error: "Sign-up is not open" });
    const parsed = body.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid sign-up" });
    const recent = await pool.query<{ count: string }>(
      "SELECT count(*) FROM accounts WHERE created_at>now()-interval '1 day' AND guest_expires_at IS NULL",
    );
    if (Number(recent.rows[0]!.count) >= dailyCap)
      return reply
        .code(503)
        .send({ error: "Sign-ups are busy. Try again tomorrow." });
    const address = parsed.data.email;
    try {
      const existing = await pool.query<{
        id: string;
        email_verified: boolean;
      }>(
        "SELECT id,email_verified FROM accounts WHERE email=$1 AND guest_expires_at IS NULL",
        [address],
      );
      const found = existing.rows[0];
      if (!found) {
        const id = randomUUID();
        await pool.query(
          "INSERT INTO accounts(id,email,password_hash,email_verified) VALUES ($1,$2,$3,false)",
          [id, address, await hash(parsed.data.password)],
        );
        await sendVerification(id, address);
      } else if (!found.email_verified) {
        // The earlier attempt was never confirmed: replace its password with this one and send a fresh link.
        await pool.query("UPDATE accounts SET password_hash=$2 WHERE id=$1", [
          found.id,
          await hash(parsed.data.password),
        ]);
        await sendVerification(found.id, address);
      } else {
        await mailer!.send({
          to: address,
          subject: "Beacon Remote sign-up",
          text: `Someone tried to create a Beacon Remote account with this address, which already has one.\n\nIf it was you, sign in at ${config.WEB_ORIGIN} or choose Forgot password there. If not, ignore this message; nothing changed.\n`,
        });
      }
    } catch {
      return reply.code(503).send({
        error: "We could not send the email. Try again in a few minutes.",
      });
    }
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/signup/resend", limit(5), async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    if (!open) return reply.code(404).send({ error: "Sign-up is not open" });
    const parsed = z.object({ email }).strict().safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid request" });
    try {
      const found = await pool.query<{ id: string }>(
        `SELECT a.id FROM accounts a WHERE a.email=$1 AND NOT a.email_verified AND a.guest_expires_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM email_verifications v WHERE v.account_id=a.id
                           AND v.created_at>now()-make_interval(secs=>$2))`,
        [parsed.data.email, RESEND_GAP_SECONDS],
      );
      if (found.rows[0])
        await sendVerification(found.rows[0].id, parsed.data.email);
    } catch {
      return reply.code(503).send({ error: "We could not send the email." });
    }
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/signup/verify", limit(20), async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const parsed = z.object({ token }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid link" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const used = await client.query<{ account_id: string }>(
        "DELETE FROM email_verifications WHERE token_hash=$1 AND expires_at>now() RETURNING account_id",
        [digest(parsed.data.token)],
      );
      if (!used.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "That link did not work" });
      }
      await client.query(
        "UPDATE accounts SET email_verified=true WHERE id=$1",
        [used.rows[0]!.account_id],
      );
      await client.query("COMMIT");
      setSessionCookie(reply, await startSession(used.rows[0]!.account_id));
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  // Password recovery by email: the same one-time link the operator-issued flow uses (ADR 0026), sent to the
  // address on the account. Two-step sign-in still applies afterwards.
  app.post("/api/account/recover/request", limit(5), async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    if (!mailer)
      return reply.code(404).send({ error: "Email recovery is not available" });
    const parsed = z.object({ email }).strict().safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid request" });
    try {
      const found = await pool.query<{ id: string }>(
        `SELECT a.id FROM accounts a WHERE a.email=$1 AND a.email_verified AND a.guest_expires_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM account_recoveries r WHERE r.account_id=a.id
                           AND r.claimed_at IS NULL AND r.created_at>now()-make_interval(secs=>$2))`,
        [parsed.data.email, RESEND_GAP_SECONDS * 2],
      );
      if (found.rows[0]) {
        const raw = randomBytes(32).toString("base64url");
        await pool.query(
          "INSERT INTO account_recoveries(token_hash,account_id,expires_at) VALUES ($1,$2,now()+make_interval(mins=>$3))",
          [digest(raw), found.rows[0].id, RECOVERY_MINUTES],
        );
        await mailer.send({
          to: parsed.data.email,
          subject: "Reset your Beacon Remote password",
          text: `Use this link to choose a new password for Beacon Remote:\n\n${link(`recover=${raw}`)}\n\nThe link works once and expires in ${RECOVERY_MINUTES} minutes. If you did not ask for this, ignore this message; your password has not changed.\n`,
        });
      }
    } catch {
      return reply.code(503).send({ error: "We could not send the email." });
    }
    return reply.code(202).send({ ok: true });
  });

  // Accounts that never confirmed their address are removed after two days.
  const purge = () =>
    void pool
      .query(
        "DELETE FROM accounts WHERE NOT email_verified AND created_at<now()-make_interval(hours=>$1)",
        [PURGE_UNVERIFIED_HOURS],
      )
      .catch(() => undefined);
  purge();
  const timer = setInterval(purge, 10 * 60 * 1000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  return { open };
}
