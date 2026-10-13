// Export and deletion of an account's own data. Both need the password again (and the second step when it
// is on), so a stolen browser session alone cannot take the data or erase the account.
import { verify } from "@node-rs/argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

const confirm = z
  .object({
    password: z.string().min(1).max(512),
    code: z.string().min(6).max(16).optional(),
  })
  .strict();
const deletion = confirm.extend({ confirm: z.literal("DELETE") }).strict();

export function registerAccountData(
  app: FastifyInstance,
  pool: Pool,
  owner: (request: FastifyRequest) => Promise<string | null>,
  sameOrigin: (request: FastifyRequest) => boolean,
  mfa: {
    enabled: (account: string) => Promise<boolean>;
    check: (account: string, code: string) => Promise<boolean>;
  },
  clearSession: (reply: FastifyReply) => void,
) {
  const limit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  // Resolves to the account id when the caller proves who they are again, otherwise sends the error.
  async function reauthenticate(
    request: FastifyRequest,
    reply: FastifyReply,
    body: z.infer<typeof confirm>,
  ): Promise<string | null> {
    const account = await owner(request);
    if (!account) {
      void reply.code(401).send({ error: "Sign in required" });
      return null;
    }
    const row = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM accounts WHERE id=$1",
      [account],
    );
    const passwordOk =
      row.rowCount === 1 &&
      (await verify(row.rows[0]!.password_hash, body.password));
    const needsCode = await mfa.enabled(account);
    const codeOk =
      !needsCode || (!!body.code && (await mfa.check(account, body.code)));
    if (!passwordOk || !codeOk) {
      void reply.code(401).send({ error: "Password or code did not work" });
      return null;
    }
    return account;
  }

  app.post("/api/account/export", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const body = confirm.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "Invalid request" });
    const account = await reauthenticate(request, reply, body.data);
    if (!account) return reply;
    const one = async (sql: string) => (await pool.query(sql, [account])).rows;
    const data = {
      exportedAt: new Date().toISOString(),
      account: (
        await one(
          `SELECT id,email,created_at AS "createdAt" FROM accounts WHERE id=$1`,
        )
      )[0],
      twoStepSignIn: await mfa.enabled(account),
      computers: await one(
        `SELECT id,name,created_at AS "createdAt",last_seen_at AS "lastSeenAt",revoked_at AS "revokedAt"
         FROM machines WHERE account_id=$1 ORDER BY created_at`,
      ),
      sessions: await one(
        `SELECT id,machine_id AS "machineId",source,capability,status,created_at AS "createdAt"
         FROM view_sessions WHERE account_id=$1 ORDER BY created_at`,
      ),
      activity: await one(
        `SELECT machine_id AS "machineId",action,occurred_at AS "occurredAt"
         FROM audit_events WHERE account_id=$1 ORDER BY id`,
      ),
      helpers: await one(
        `SELECT r.id,r.machine_id AS "machineId",r.capability,r.expires_at AS "expiresAt",
                r.created_at AS "createdAt",r.revoked_at AS "revokedAt"
         FROM support_relationships r JOIN machines m ON m.id=r.machine_id
         WHERE m.account_id=$1 ORDER BY r.created_at`,
      ),
    };
    await pool.query(
      "INSERT INTO audit_events(account_id,action) VALUES ($1,'account.exported')",
      [account],
    );
    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="beacon-remote-data.json"',
      );
    return JSON.stringify(data, null, 2);
  });

  app.post("/api/account/delete", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const body = deletion.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "Invalid request" });
    const account = await reauthenticate(request, reply, body.data);
    if (!account) return reply;
    // Foreign keys remove the computers, sessions, helpers, history and sign-in sessions with the account;
    // each computer's next heartbeat is then refused and it shows as unpaired.
    await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
    clearSession(reply);
    return { ok: true };
  });
}
