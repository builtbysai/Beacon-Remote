// Teams (ADR 0037): the owner names accounts that may help with all of their computers, or one group of them.
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

export const MAX_TEAM_MEMBERS = 15;
// Team shares carry no expiry of their own; they last until the member or the computer leaves the team's scope.
const NO_EXPIRY = "9999-12-31T00:00:00Z";

const role = z.enum(["viewer", "technician"]);
const memberBody = z
  .object({
    email: z.email().max(254),
    role,
    group: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .strict();
const memberParams = z.object({ id: z.uuid() });

/**
 * Makes the owner's support relationships match their team: one active share per member and computer in scope,
 * with the member's role as its capability. Shares that no longer match (member removed, computer moved out of
 * the group, role changed, computer revoked) are revoked; a share the owner made by hand is left alone.
 * Returns the shares revoked, so sessions that relied on them can be ended.
 */
export async function syncTeam(
  client: Pool | PoolClient,
  owner: string,
): Promise<string[]> {
  const revoked = await client.query<{ id: string }>(
    `UPDATE support_relationships r SET revoked_at=now()
     WHERE r.team_member_id IS NOT NULL AND r.revoked_at IS NULL
       AND r.machine_id IN (SELECT id FROM machines WHERE account_id=$1)
       AND NOT EXISTS (
         SELECT 1 FROM team_members t JOIN machines m ON m.id=r.machine_id
         WHERE t.id=r.team_member_id AND t.removed_at IS NULL AND m.revoked_at IS NULL
           AND (t.group_name IS NULL OR m.group_name=t.group_name)
           AND r.capability = CASE t.role WHEN 'technician' THEN 'desktop:control' ELSE 'desktop:view' END)
     RETURNING r.id`,
    [owner],
  );
  await client.query(
    `INSERT INTO support_relationships(id,machine_id,helper_account_id,capability,expires_at,team_member_id)
     SELECT gen_random_uuid(), m.id, t.member_account_id,
            CASE t.role WHEN 'technician' THEN 'desktop:control' ELSE 'desktop:view' END, $2::timestamptz, t.id
     FROM team_members t
     JOIN machines m ON m.account_id=t.owner_account_id AND m.revoked_at IS NULL
          AND (t.group_name IS NULL OR m.group_name=t.group_name)
     WHERE t.owner_account_id=$1 AND t.removed_at IS NULL
     ON CONFLICT (machine_id, helper_account_id) WHERE revoked_at IS NULL DO NOTHING`,
    [owner, NO_EXPIRY],
  );
  return revoked.rows.map((row) => row.id);
}

export function registerTeam(
  app: FastifyInstance,
  pool: Pool,
  owner: (request: FastifyRequest) => Promise<string | null>,
  sameOrigin: (request: FastifyRequest) => boolean,
  // Ends sessions that relied on revoked shares now, not at their next renewal.
  endRelationshipSessions: (relationships: string[]) => Promise<void>,
) {
  const limit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  app.get("/api/team", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const result = await pool.query(
      `SELECT t.id,a.email,t.role,t.group_name AS "group",
              (extract(epoch FROM t.created_at)*1000)::bigint AS "addedAtMillis",
              (SELECT count(*)::int FROM support_relationships r
                WHERE r.team_member_id=t.id AND r.revoked_at IS NULL) AS computers
       FROM team_members t JOIN accounts a ON a.id=t.member_account_id
       WHERE t.owner_account_id=$1 AND t.removed_at IS NULL ORDER BY t.created_at`,
      [account],
    );
    return {
      members: result.rows.map((row) => ({
        ...row,
        addedAtMillis: Number(row.addedAtMillis),
      })),
    };
  });

  // Adds a member, or changes the role or group of an existing one.
  app.post("/api/team", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const body = memberBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "Invalid team member" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialises this owner's team changes with each other.
      await client.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        account,
      ]);
      const person = await client.query<{ id: string }>(
        "SELECT id FROM accounts WHERE lower(email)=lower($1) AND id<>$2 AND guest_expires_at IS NULL",
        [body.data.email, account],
      );
      if (!person.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Could not add that account" });
      }
      const group = body.data.group ?? null;
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM team_members WHERE owner_account_id=$1 AND member_account_id=$2 AND removed_at IS NULL",
        [account, person.rows[0]!.id],
      );
      if (existing.rowCount) {
        await client.query(
          "UPDATE team_members SET role=$2,group_name=$3 WHERE id=$1",
          [existing.rows[0]!.id, body.data.role, group],
        );
      } else {
        const count = await client.query(
          "SELECT count(*)::int AS n FROM team_members WHERE owner_account_id=$1 AND removed_at IS NULL",
          [account],
        );
        if (count.rows[0].n >= MAX_TEAM_MEMBERS) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "Too many team members" });
        }
        await client.query(
          "INSERT INTO team_members(id,owner_account_id,member_account_id,role,group_name) VALUES (gen_random_uuid(),$1,$2,$3,$4)",
          [account, person.rows[0]!.id, body.data.role, group],
        );
      }
      const revoked = await syncTeam(client, account);
      await client.query(
        "INSERT INTO audit_events(account_id,action) VALUES ($1,$2)",
        [
          account,
          existing.rowCount ? "team.member.changed" : "team.member.added",
        ],
      );
      await client.query("COMMIT");
      await endRelationshipSessions(revoked);
      return { ok: true };
    } catch {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: "Team change rejected" });
    } finally {
      client.release();
    }
  });

  app.post("/api/team/:id/remove", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = memberParams.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid team member" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const removed = await client.query(
        "UPDATE team_members SET removed_at=now() WHERE id=$1 AND owner_account_id=$2 AND removed_at IS NULL RETURNING id",
        [path.data.id, account],
      );
      if (!removed.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Team member unavailable" });
      }
      const revoked = await syncTeam(client, account);
      await client.query(
        "INSERT INTO audit_events(account_id,action) VALUES ($1,'team.member.removed')",
        [account],
      );
      await client.query("COMMIT");
      await endRelationshipSessions(revoked);
      return { ok: true, ended: revoked.length };
    } catch {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: "Team change rejected" });
    } finally {
      client.release();
    }
  });
}
