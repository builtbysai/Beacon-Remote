import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  signinHandoffProof,
  signinHandoffMessage,
} from "../../../packages/protocol/src/index.js";
import {
  signinLeaseJoins,
  signinLiveHandoff,
  signinValidSignature,
  consumeSigninNonce,
} from "./signin-shared.js";
import { interactiveReadySql } from "./machine-readiness.js";

export function registerSigninHandoff(
  app: FastifyInstance,
  pool: Pool,
  owner: (request: FastifyRequest) => Promise<string | null>,
  enabled: boolean,
  stopSignaling: (id: string) => Promise<void>,
) {
  app.post("/api/signin/handoff", async (request, reply) => {
    if (!enabled)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const parsed = signinHandoffProof.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid handoff proof" });
    const proof = parsed.data;
    if (Math.abs(Date.now() - proof.timestamp) > 30000)
      return reply.code(401).send({ error: "Handoff rejected" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const endpoint = (
        await client.query<{ public_key: Buffer }>(
          `SELECT e.public_key FROM machines m JOIN signin_endpoints e ON e.machine_id=m.id
        WHERE m.id=$1 AND m.revoked_at IS NULL AND m.support_link_id IS NULL AND e.enabled FOR UPDATE OF m,e`,
          [proof.machineId],
        )
      ).rows[0];
      if (
        !endpoint ||
        !signinValidSignature(
          endpoint.public_key,
          signinHandoffMessage(proof),
          proof.signature,
        )
      ) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Handoff rejected" });
      }
      if (!(await consumeSigninNonce(client, proof.machineId, proof.nonce))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Handoff rejected" });
      }
      const lease = await client.query(
        `SELECT s.id,s.account_id ${signinLeaseJoins}
        WHERE s.id=$1 AND s.machine_id=$2 AND s.instance_id=$3 AND s.console_session_id=$4
        AND e.instance_id=s.instance_id AND e.console_session_id=s.console_session_id AND e.version=s.endpoint_version
        AND e.state='sign-in' AND e.worker_public_key IS NOT NULL AND e.last_seen_at>now()-interval '15 seconds'
        AND (s.ended_at IS NULL OR (s.ended_reason='transport' AND s.ended_at>now()-interval '8 seconds'))
        AND s.expires_at>now() AND s.deadline>now() AND b.expires_at>now() AND b.account_id=s.account_id
        AND m.account_id=s.account_id AND p.mode='trusted' AND p.allow_control AND p.version=s.policy_version
        FOR UPDATE OF s,b,p`,
        [
          proof.leaseId,
          proof.machineId,
          proof.instanceId,
          proof.consoleSessionId,
        ],
      );
      if (!lease.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Handoff unavailable" });
      }
      await client.query(
        `UPDATE signin_leases s SET ended_at=COALESCE(ended_at,now()),ended_reason='handoff',
        handoff_expires_at=LEAST(s.deadline,b.expires_at,now()+interval '30 seconds')
        FROM browser_sessions b WHERE s.id=$1 AND b.token_hash=s.browser_token_hash`,
        [proof.leaseId],
      );
      await client.query(
        "UPDATE signin_endpoints SET state='signed-in',worker_ready=false,worker_public_key=NULL,last_seen_at=now() WHERE machine_id=$1",
        [proof.machineId],
      );
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'signin.handoff.ready')",
        [lease.rows[0].account_id, proof.machineId],
      );
      await client.query("COMMIT");
      void stopSignaling(proof.leaseId);
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.get("/api/signin/leases/:id/handoff", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    if (!enabled)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid sign-in lease" });
    const found = await pool.query(
      `SELECT s.id,s.machine_id,s.instance_id,s.console_session_id,m.host_instance_id,m.host_console_session_id,
      (${signinLiveHandoff}) AS transition,(${interactiveReadySql}) AS host_ready,
      (s.expires_at>now() AND s.deadline>now() AND (s.ended_at IS NULL OR (s.ended_reason='transport' AND s.ended_at>now()-interval '8 seconds'))
        AND m.revoked_at IS NULL AND e.enabled AND e.version=s.endpoint_version AND p.version=s.policy_version AND p.mode='trusted' AND p.allow_control) AS waiting
      ${signinLeaseJoins} WHERE s.id=$1 AND s.account_id=$2 AND s.browser_token_hash=$3 AND b.expires_at>now()`,
      [
        parsed.data.id,
        account,
        createHash("sha256")
          .update(request.cookies.remote_session ?? "")
          .digest("hex"),
      ],
    );
    const row = found.rows[0];
    if (!row || (!row.transition && !row.waiting))
      return reply.code(404).send({ error: "Handoff unavailable" });
    if (
      !row.transition ||
      !row.host_ready ||
      !row.host_instance_id ||
      row.host_console_session_id !== row.console_session_id
    )
      return { state: "pending" };
    return {
      state: "ready",
      machineId: row.machine_id,
      leaseId: row.id,
      instanceId: row.instance_id,
      consoleSessionId: Number(row.console_session_id),
      hostContext: {
        instanceId: row.host_instance_id,
        consoleSessionId: Number(row.host_console_session_id),
      },
    };
  });
}
