// Disconnect now, and uninstall and remove a computer (ADR 0039). Revoking (existing route) is the third action.
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  supportEndRequest,
  uninstallMessage,
} from "../../../packages/protocol/src/index.js";

export const UNINSTALL_DAYS = 30;
const idParams = z.object({ id: z.uuid() });

export function registerDeviceRemoval(
  app: FastifyInstance,
  pool: Pool,
  owner: (request: FastifyRequest) => Promise<string | null>,
  sameOrigin: (request: FastifyRequest) => boolean,
  signedByMachine: (
    machineId: string,
    message: string,
    signature: string,
    pendingUninstall?: boolean,
  ) => Promise<boolean>,
  wake: (machineId: string) => void,
  endMachineSessions: (machineId: string) => Promise<void>,
  endRelationshipSessions: (relationships: string[]) => Promise<void>,
  syncTeam: (pool: Pool, owner: string) => Promise<string[]>,
) {
  const limit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  // Ends every live session now. The computer stays enrolled and available for future authorised access.
  app.post("/api/machines/:id/disconnect", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid machine" });
    const mine = await pool.query(
      "SELECT 1 FROM machines WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL",
      [path.data.id, account],
    );
    if (!mine.rowCount)
      return reply.code(404).send({ error: "Machine unavailable" });
    await endMachineSessions(path.data.id);
    await pool.query(
      "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'machine.disconnected')",
      [account, path.data.id],
    );
    wake(path.data.id);
    return { ok: true };
  });

  // Wake-on-LAN (ADR 0042): another of the owner's online computers on the same network sends the magic packet. The
  // server cannot reach into a home network, so with no such neighbour there is nothing it can honestly do.
  app.post("/api/machines/:id/wake", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid machine" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<{
        macs: string[] | null;
        lan_key: string | null;
        public_ip_hash: string | null;
        online: boolean;
      }>(
        `SELECT macs,lan_key,public_ip_hash,COALESCE(last_seen_at>now()-interval '45 seconds',false) AS online
         FROM machines WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND support_link_id IS NULL FOR UPDATE`,
        [path.data.id, account],
      );
      const row = target.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Machine unavailable" });
      }
      if (row.online) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Already online" });
      }
      const recent = await client.query(
        "SELECT 1 FROM wake_requests WHERE target_machine_id=$1 AND created_at>now()-interval '20 seconds'",
        [path.data.id],
      );
      if (recent.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(429).send({ error: "Wake already requested" });
      }
      const neighbour = row.macs?.length
        ? await client.query<{ id: string; name: string }>(
            `SELECT id,name FROM machines
             WHERE account_id=$1 AND id<>$2 AND revoked_at IS NULL AND support_link_id IS NULL
               AND lan_key=$3 AND public_ip_hash=$4 AND last_seen_at>now()-interval '45 seconds'
             ORDER BY last_seen_at DESC LIMIT 1`,
            [account, path.data.id, row.lan_key, row.public_ip_hash],
          )
        : null;
      const via = neighbour?.rows[0];
      if (!via) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "No computer on its network" });
      }
      for (const mac of row.macs!)
        await client.query(
          "INSERT INTO wake_requests(id,target_machine_id,via_machine_id,mac) VALUES (gen_random_uuid(),$1,$2,$3)",
          [path.data.id, via.id, mac],
        );
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'machine.wake.requested')",
        [account, path.data.id],
      );
      await client.query("COMMIT");
      wake(via.id);
      return { ok: true, via: via.name };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  // Restarts a computer the owner trusts with control (ADR 0043). Only the owner's own trusted-with-control policy
  // permits it: a restart ends everything on the computer, so it needs at least the authority of control.
  app.post("/api/machines/:id/restart", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid machine" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT 1 FROM machines m JOIN machine_access a ON a.machine_id=m.id
         WHERE m.id=$1 AND m.account_id=$2 AND m.revoked_at IS NULL AND m.support_link_id IS NULL
           AND m.last_seen_at>now()-interval '45 seconds' AND a.mode='trusted' AND a.allow_control FOR UPDATE OF m`,
        [path.data.id, account],
      );
      if (!found.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Restart unavailable" });
      }
      const recent = await client.query(
        "SELECT 1 FROM machine_restarts WHERE machine_id=$1 AND created_at>now()-interval '2 minutes'",
        [path.data.id],
      );
      if (recent.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(429).send({ error: "Restart already requested" });
      }
      await client.query(
        "INSERT INTO machine_restarts(id,machine_id) VALUES (gen_random_uuid(),$1)",
        [path.data.id],
      );
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'machine.restart.requested')",
        [account, path.data.id],
      );
      await client.query("COMMIT");
      wake(path.data.id);
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  // Revokes the computer now (it can no longer start or join anything) and leaves one bounded instruction for its own
  // agent to remove itself if it ever reconnects. Nothing can reach into an unreachable computer.
  app.post("/api/machines/:id/uninstall", limit, async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const path = idParams.safeParse(request.params);
    if (!path.success)
      return reply.code(400).send({ error: "Invalid machine" });
    const result = await pool.query<{ online: boolean }>(
      `UPDATE machines SET revoked_at=COALESCE(revoked_at,now()),
         uninstall_requested_at=COALESCE(uninstall_requested_at,now())
       WHERE id=$1 AND account_id=$2 AND support_link_id IS NULL AND uninstalled_at IS NULL
       RETURNING (last_seen_at>now()-interval '45 seconds') AS online`,
      [path.data.id, account],
    );
    if (!result.rowCount)
      return reply.code(404).send({ error: "Machine unavailable" });
    await pool.query(
      "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'machine.uninstall.requested')",
      [account, path.data.id],
    );
    await endMachineSessions(path.data.id);
    wake(path.data.id);
    await endRelationshipSessions(await syncTeam(pool, account));
    return { ok: true, online: result.rows[0]!.online === true };
  });

  // The computer confirms it has removed itself, signed with its own key; only while the instruction is live.
  app.post(
    "/api/agent/uninstall-done",
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
          uninstallMessage(
            body.data.machineId,
            body.data.timestamp,
            body.data.nonce,
          ),
          body.data.signature,
          true,
        ))
      )
        return reply.code(401).send({ error: "Rejected" });
      const done = await pool.query<{ account_id: string }>(
        "UPDATE machines SET uninstalled_at=now() WHERE id=$1 AND uninstalled_at IS NULL RETURNING account_id",
        [body.data.machineId],
      );
      if (done.rowCount)
        await pool.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'machine.uninstalled')",
          [done.rows[0]!.account_id, body.data.machineId],
        );
      return { ok: true };
    },
  );
}
