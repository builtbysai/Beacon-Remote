// Chat, notes and handoff for temporary support sessions (ADR 0040).
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  chatMessage,
  chatRequest,
} from "../../../packages/protocol/src/index.js";

const idParams = z.object({ id: z.uuid() });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const MAX_MESSAGES_RETURNED = 100;

export function registerSupportWorkflow(
  app: FastifyInstance,
  pool: Pool,
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
  const limit = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  // The technician's side of the conversation for one temporary computer they own.
  async function ownedSupportMachine(account: string, machineId: string) {
    const result = await pool.query(
      "SELECT 1 FROM machines WHERE id=$1 AND account_id=$2 AND support_link_id IS NOT NULL",
      [machineId, account],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const messages = async (machineId: string, since: number) =>
    (
      await pool.query<{
        id: string;
        sender: string;
        body: string;
        at: string;
      }>(
        `SELECT id::text,sender,body,(extract(epoch FROM created_at)*1000)::bigint::text AS at
         FROM support_messages WHERE machine_id=$1 AND id>$2 ORDER BY id LIMIT ${MAX_MESSAGES_RETURNED}`,
        [machineId, since],
      )
    ).rows.map((row) => ({
      id: Number(row.id),
      sender: row.sender,
      body: row.body,
      atMillis: Number(row.at),
    }));

  app.get("/api/machines/:id/chat", limit, async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    const query = z
      .object({ since: z.coerce.number().int().min(0).default(0) })
      .safeParse(request.query);
    if (!path.success || !query.success)
      return reply.code(400).send({ error: "Invalid request" });
    if (!(await ownedSupportMachine(account, path.data.id)))
      return reply.code(404).send({ error: "Unavailable" });
    return { messages: await messages(path.data.id, query.data.since) };
  });

  app.post("/api/machines/:id/chat", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    const body = z
      .object({ text: z.string().trim().min(1).max(1000) })
      .strict()
      .safeParse(request.body);
    if (!path.success || !body.success)
      return reply.code(400).send({ error: "Invalid message" });
    if (!(await ownedSupportMachine(account, path.data.id)))
      return reply.code(404).send({ error: "Unavailable" });
    await pool.query(
      `INSERT INTO support_messages(machine_id,sender,body)
       SELECT id,'technician',$2 FROM machines WHERE id=$1 AND revoked_at IS NULL`,
      [path.data.id, body.data.text],
    );
    return { ok: true };
  });

  // The person's support program: send an optional message and receive what is new, in one signed request. It also
  // learns who the technician is now, in case the session was handed over.
  app.post(
    "/api/agent/chat",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = chatRequest.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: "Invalid request" });
      const data = body.data;
      if (Math.abs(Date.now() - data.timestamp) > 30_000)
        return reply.code(401).send({ error: "Rejected" });
      if (
        !(await signedByMachine(
          data.machineId,
          chatMessage(
            data.machineId,
            data.timestamp,
            data.nonce,
            data.since,
            data.text ? sha(data.text) : "",
          ),
          data.signature,
        ))
      )
        return reply.code(401).send({ error: "Rejected" });
      const nonce = await pool.query(
        "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [data.machineId, data.nonce],
      );
      if (!nonce.rowCount) return reply.code(409).send({ error: "Rejected" });
      const support = await pool.query<{ email: string }>(
        `SELECT a.email FROM machines m JOIN accounts a ON a.id=m.account_id
         WHERE m.id=$1 AND m.support_link_id IS NOT NULL AND m.revoked_at IS NULL`,
        [data.machineId],
      );
      if (!support.rowCount) return reply.code(403).send({ error: "Rejected" });
      if (data.text)
        await pool.query(
          "INSERT INTO support_messages(machine_id,sender,body) VALUES ($1,'person',$2)",
          [data.machineId, data.text],
        );
      return {
        technician: support.rows[0]!.email,
        messages: await messages(data.machineId, data.since),
      };
    },
  );

  // Private to the technician: what they did and what to remember.
  app.post("/api/support-links/:id/notes", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    const body = z
      .object({ notes: z.string().max(4000) })
      .strict()
      .safeParse(request.body);
    if (!path.success || !body.success)
      return reply.code(400).send({ error: "Invalid notes" });
    const result = await pool.query(
      "UPDATE support_links SET notes=NULLIF($3,'') WHERE id=$1 AND account_id=$2",
      [path.data.id, account, body.data.notes],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "Unavailable" });
    return { ok: true };
  });

  // Hands a live support session to another of the owner's technicians. The session in progress ends so exactly one
  // technician holds the computer at a time; the person keeps their program, their chat and their approval.
  app.post("/api/support-links/:id/handoff", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    const body = z
      .object({ email: z.email().max(254) })
      .strict()
      .safeParse(request.body);
    if (!path.success || !body.success)
      return reply.code(400).send({ error: "Invalid handoff" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const link = await client.query<{ machine_id: string }>(
        `SELECT m.id AS machine_id FROM support_links l JOIN machines m ON m.support_link_id=l.id
         WHERE l.id=$1 AND l.account_id=$2 AND l.ended_at IS NULL AND m.revoked_at IS NULL FOR UPDATE OF l,m`,
        [path.data.id, account],
      );
      const target = await client.query<{ id: string; email: string }>(
        `SELECT a.id,a.email FROM team_members t JOIN accounts a ON a.id=t.member_account_id
         WHERE t.owner_account_id=$1 AND t.removed_at IS NULL AND t.role='technician'
           AND lower(a.email)=lower($2) AND a.guest_expires_at IS NULL`,
        [account, body.data.email],
      );
      if (!link.rowCount || !target.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Handoff unavailable" });
      }
      const machineId = link.rows[0]!.machine_id;
      const next = target.rows[0]!;
      await client.query("UPDATE support_links SET account_id=$2 WHERE id=$1", [
        path.data.id,
        next.id,
      ]);
      await client.query("UPDATE machines SET account_id=$2 WHERE id=$1", [
        machineId,
        next.id,
      ]);
      await client.query(
        "INSERT INTO support_messages(machine_id,sender,body) VALUES ($1,'system',$2)",
        [machineId, `Your technician is now ${next.email}.`],
      );
      for (const who of [account, next.id])
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action,actor_account_id) VALUES ($1,$2,'support.handoff',$3)",
          [who, machineId, account],
        );
      await client.query("COMMIT");
      await endMachineSessions(machineId);
      wake(machineId);
      return { ok: true };
    } catch {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: "Handoff unavailable" });
    } finally {
      client.release();
    }
  });
}
