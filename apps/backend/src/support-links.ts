// One-click temporary support (ADR 0038): a technician makes a short-lived link, the support client the recipient
// runs redeems it once and becomes a temporary computer in the technician's list, and ending support (by either
// side, or the time limit) revokes that computer so nothing remains.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  supportClaim,
  supportEndMessage,
  supportEndRequest,
} from "../../../packages/protocol/src/index.js";

// How long a link can be redeemed, and how long a temporary computer lasts once it has been.
export const LINK_HOURS = 24;
export const SUPPORT_SESSION_HOURS = 8;
export const MAX_OPEN_LINKS = 20;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const createBody = z
  .object({
    capability: z.enum(["desktop:view", "desktop:control"]),
    label: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
const tokenBody = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) })
  .strict();
const idParams = z.object({ id: z.uuid() });

type Ended = "technician" | "recipient" | "expired";

/**
 * Ends a link and revokes the temporary computer it created, inside the caller's transaction. Returns the computer
 * so the caller can wake it and stop its sessions. Ending twice is harmless.
 */
async function endLink(
  client: Pool | PoolClient,
  linkId: string,
  by: Ended,
): Promise<{ machineId: string; account: string } | null> {
  const ended = await client.query<{ account_id: string }>(
    "UPDATE support_links SET ended_at=now(),ended_by=$2 WHERE id=$1 AND ended_at IS NULL RETURNING account_id",
    [linkId, by],
  );
  if (!ended.rowCount) return null;
  const machine = await client.query<{ id: string }>(
    "UPDATE machines SET revoked_at=COALESCE(revoked_at,now()) WHERE support_link_id=$1 RETURNING id",
    [linkId],
  );
  const machineId = machine.rows[0]?.id;
  if (machineId) {
    await client.query(
      "UPDATE view_sessions SET status='ended' WHERE machine_id=$1 AND status IN ('requested','connecting','active')",
      [machineId],
    );
  }
  await client.query(
    "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
    [ended.rows[0]!.account_id, machineId ?? null, `support.link.ended:${by}`],
  );
  return machineId ? { machineId, account: ended.rows[0]!.account_id } : null;
}

export function registerSupportLinks(
  app: FastifyInstance,
  pool: Pool,
  config: { WEB_ORIGIN: string; CONTROL_ENABLED?: "true" },
  owner: (request: FastifyRequest) => Promise<string | null>,
  sameOrigin: (request: FastifyRequest) => boolean,
  signedByMachine: (
    machineId: string,
    message: string,
    signature: string,
  ) => Promise<boolean>,
  wake: (machineId: string) => void,
  endMachineSessions: (machineId: string) => Promise<void>,
) {
  const limit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
  const publicLimit = {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  };

  // Links whose computer ran out its time limit end here, whether or not anything is still connected.
  const sweep = async () => {
    const due = await pool.query<{ id: string }>(
      `SELECT l.id FROM support_links l JOIN machines m ON m.support_link_id=l.id
       WHERE l.ended_at IS NULL AND m.temporary_until<now()`,
    );
    for (const row of due.rows) {
      const ended = await endLink(pool, row.id, "expired");
      if (ended) {
        wake(ended.machineId);
        await endMachineSessions(ended.machineId);
      }
    }
  };
  const timer = setInterval(() => void sweep().catch(() => undefined), 60_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));

  app.post("/api/support-links", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const body = createBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "Invalid support link" });
    if (
      body.data.capability === "desktop:control" &&
      config.CONTROL_ENABLED !== "true"
    )
      return reply.code(403).send({ error: "Control unavailable" });
    const open = await pool.query(
      `SELECT count(*)::int AS n FROM support_links
       WHERE account_id=$1 AND ended_at IS NULL AND (claimed_at IS NOT NULL OR expires_at>now())`,
      [account],
    );
    if (open.rows[0].n >= MAX_OPEN_LINKS)
      return reply.code(429).send({ error: "Too many open support links" });
    const token = randomBytes(24).toString("base64url");
    const id = randomUUID();
    await pool.query(
      `INSERT INTO support_links(id,account_id,token_hash,capability,label,expires_at)
       VALUES ($1,$2,$3,$4,$5,now()+make_interval(hours=>$6))`,
      [
        id,
        account,
        digest(token),
        body.data.capability,
        body.data.label ?? null,
        LINK_HOURS,
      ],
    );
    await pool.query(
      "INSERT INTO audit_events(account_id,action) VALUES ($1,$2)",
      [
        account,
        `support.link.created:${body.data.capability === "desktop:control" ? "control" : "view"}`,
      ],
    );
    return {
      id,
      url: `${config.WEB_ORIGIN}/#support=${token}`,
      expiresInSeconds: LINK_HOURS * 3600,
    };
  });

  // The technician's waiting room: every link that is still open or in use, and the recent ones that finished.
  app.get("/api/support-links", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const result = await pool.query(
      `SELECT l.id,l.label,l.capability,
              (extract(epoch FROM l.created_at)*1000)::bigint AS "createdAtMillis",
              (extract(epoch FROM l.expires_at)*1000)::bigint AS "expiresAtMillis",
              CASE WHEN l.ended_at IS NOT NULL THEN 'ended'
                   WHEN l.claimed_at IS NULL AND l.expires_at<=now() THEN 'expired'
                   WHEN l.claimed_at IS NULL THEN 'waiting'
                   WHEN m.last_seen_at>now()-interval '45 seconds' THEN 'connected'
                   ELSE 'offline' END AS state,
              l.ended_by AS "endedBy",
              m.id AS "machineId",m.name,
              (extract(epoch FROM m.temporary_until)*1000)::bigint AS "untilMillis"
       FROM support_links l LEFT JOIN machines m ON m.support_link_id=l.id
       WHERE l.account_id=$1 AND (l.ended_at IS NULL OR l.ended_at>now()-interval '2 days')
       ORDER BY l.created_at DESC LIMIT 50`,
      [account],
    );
    return {
      links: result.rows.map((row) => ({
        ...row,
        createdAtMillis: Number(row.createdAtMillis),
        expiresAtMillis: Number(row.expiresAtMillis),
        untilMillis: row.untilMillis === null ? null : Number(row.untilMillis),
      })),
    };
  });

  // Ends a link: cancels one nobody used yet, or finishes support and revokes the temporary computer.
  app.post("/api/support-links/:id/end", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid support link" });
    const mine = await pool.query(
      "SELECT 1 FROM support_links WHERE id=$1 AND account_id=$2",
      [path.data.id, account],
    );
    if (!mine.rowCount)
      return reply.code(404).send({ error: "Support link unavailable" });
    const ended = await endLink(pool, path.data.id, "technician");
    if (ended) {
      wake(ended.machineId);
      await endMachineSessions(ended.machineId);
    }
    return { ok: true };
  });

  // What the recipient sees before downloading: who is asking and for what. The token is single-use at claim time;
  // an unknown, used, ended or expired link all look the same.
  app.post(
    "/api/support-invite/preview",
    publicLimit,
    async (request, reply) => {
      const body = tokenBody.safeParse(request.body);
      if (!body.success) return reply.code(404).send({ error: "Unavailable" });
      const result = await pool.query(
        `SELECT a.email AS technician,l.capability,l.label,
                (extract(epoch FROM l.expires_at)*1000)::bigint AS "expiresAtMillis"
         FROM support_links l JOIN accounts a ON a.id=l.account_id
         WHERE l.token_hash=$1 AND l.claimed_at IS NULL AND l.ended_at IS NULL AND l.expires_at>now()`,
        [digest(body.data.token)],
      );
      const row = result.rows[0];
      if (!row) return reply.code(404).send({ error: "Unavailable" });
      return { ...row, expiresAtMillis: Number(row.expiresAtMillis) };
    },
  );

  // The support client redeems the link once and becomes a temporary computer. It holds no durable credential
  // beyond its own key, is never trusted, and is revoked when support ends.
  app.post(
    "/api/agent/support-claim",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = supportClaim.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: "Invalid support claim" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query<{
          id: string;
          account_id: string;
          capability: string;
        }>(
          `UPDATE support_links SET claimed_at=now()
           WHERE token_hash=$1 AND claimed_at IS NULL AND ended_at IS NULL AND expires_at>now()
           RETURNING id,account_id,capability`,
          [digest(body.data.token)],
        );
        const link = claimed.rows[0];
        if (!link) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Support link unavailable" });
        }
        const machineId = randomUUID();
        const inserted = await client.query<{ until: Date }>(
          `INSERT INTO machines(id,account_id,name,public_key,support_link_id,temporary_until)
           VALUES ($1,$2,$3,$4,$5,now()+make_interval(hours=>$6)) RETURNING temporary_until AS until`,
          [
            machineId,
            link.account_id,
            body.data.name,
            Buffer.from(body.data.publicKey, "base64"),
            link.id,
            SUPPORT_SESSION_HOURS,
          ],
        );
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'support.link.claimed')",
          [link.account_id, machineId],
        );
        const who = await client.query<{ email: string }>(
          "SELECT email FROM accounts WHERE id=$1",
          [link.account_id],
        );
        await client.query("COMMIT");
        return {
          version: 1,
          machineId,
          heartbeatIntervalSeconds: 15,
          expiresAtMillis: inserted.rows[0]!.until.getTime(),
          capability: link.capability,
          technician: who.rows[0]?.email ?? "",
        };
      } catch {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Support link unavailable" });
      } finally {
        client.release();
      }
    },
  );

  // The person at the computer ended support (or the client is cleaning up): the temporary computer is revoked now.
  app.post(
    "/api/agent/support-end",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = supportEndRequest.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: "Invalid request" });
      if (Math.abs(Date.now() - body.data.timestamp) > 30_000)
        return reply.code(401).send({ error: "Rejected" });
      if (
        !(await signedByMachine(
          body.data.machineId,
          supportEndMessage(
            body.data.machineId,
            body.data.timestamp,
            body.data.nonce,
          ),
          body.data.signature,
        ))
      )
        return reply.code(401).send({ error: "Rejected" });
      const nonce = await pool.query(
        "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [body.data.machineId, body.data.nonce],
      );
      if (!nonce.rowCount) return reply.code(409).send({ error: "Rejected" });
      const link = await pool.query<{ support_link_id: string | null }>(
        "SELECT support_link_id FROM machines WHERE id=$1",
        [body.data.machineId],
      );
      const id = link.rows[0]?.support_link_id;
      // A permanent computer is never removed by this route.
      if (!id) return reply.code(403).send({ error: "Rejected" });
      await endLink(pool, id, "recipient");
      wake(body.data.machineId);
      await endMachineSessions(body.data.machineId);
      return { ok: true };
    },
  );
}
