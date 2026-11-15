// ADR 0048 authorization boundary. This module never captures, injects input,
// launches a worker, or carries media. Readiness is not media proof.
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  signinBinding,
  signinBindingMessage,
  signinHeartbeat,
  signinHeartbeatMessage,
  signinLeaseProof,
  signinLeaseProofMessage,
  signinPendingProof,
  signinPendingProofMessage,
  signinDisableProof,
  signinDisableMessage,
} from "../../../packages/protocol/src/index.js";
import type { Config } from "./config.js";
import {
  signinLiveLease as liveLease,
  signinLeaseJoins as leaseJoins,
  signinValidSignature as validSignature,
  consumeSigninNonce as nonce,
} from "./signin-shared.js";
import { registerSigninSignaling } from "./signin-signaling.js";
import { registerSigninHandoff } from "./signin-handoff.js";

const pathSchema = z.object({ id: z.uuid() });
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
async function endLeases(
  client: PoolClient,
  machine: string,
  preserveHandoff = false,
) {
  const ended = await client.query<{ id: string }>(
    "UPDATE signin_leases SET ended_at=COALESCE(ended_at,now()),ended_reason='invalidated',handoff_expires_at=NULL WHERE machine_id=$1 AND (ended_at IS NULL OR (handoff_expires_at IS NOT NULL AND NOT $2)) RETURNING id",
    [machine, preserveHandoff],
  );
  return ended.rows.map((row) => row.id);
}

async function disableEndpoint(client: PoolClient, machine: string) {
  await client.query(
    "UPDATE signin_endpoints SET enabled=false,version=version+1,worker_ready=false,last_seen_at=NULL,worker_public_key=NULL WHERE machine_id=$1",
    [machine],
  );
  const leases = await client.query<{
    id: string;
    handoff_session_id: string | null;
  }>(
    `UPDATE signin_leases SET ended_at=COALESCE(ended_at,now()),ended_reason='invalidated',handoff_expires_at=NULL
     WHERE machine_id=$1 AND (ended_at IS NULL OR handoff_expires_at IS NOT NULL OR handoff_session_id IN
       (SELECT id FROM view_sessions WHERE status IN ('requested','connecting','active')))
     RETURNING id,handoff_session_id`,
    [machine],
  );
  const desktop = leases.rows.flatMap((row) =>
    row.handoff_session_id ? [row.handoff_session_id] : [],
  );
  if (desktop.length)
    await client.query(
      "UPDATE view_sessions SET status='ended' WHERE id=ANY($1::uuid[]) AND status IN ('requested','connecting','active')",
      [desktop],
    );
  return { leases: leases.rows.map((row) => row.id), desktop };
}

export function registerSigninAuthority(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  owner: (request: FastifyRequest) => Promise<string | null>,
  stopDesktop: (id: string) => Promise<void>,
) {
  const enabled =
    config.SIGNIN_AUTHORITY_ENABLED === "true" &&
    config.CONTROL_ENABLED === "true" &&
    Boolean(config.SESSION_SECRET);
  const mediaEnabled = enabled && config.SIGNIN_MEDIA_ENABLED === "true";
  const signaling = registerSigninSignaling(
    app,
    pool,
    config,
    owner,
    mediaEnabled,
  );
  registerSigninHandoff(app, pool, owner, mediaEnabled, signaling.stopLease);
  // Local Disable must still lower backend authority when rollout is off or
  // the worker has already exited. Only the separately registered service key
  // can sign this purpose; no request here can enable access or launch a worker.
  app.post("/api/signin/disable", async (request, reply) => {
    const parsed = signinDisableProof.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid Disable proof" });
    const proof = parsed.data;
    if (Math.abs(Date.now() - proof.timestamp) > 30_000)
      return reply.code(401).send({ error: "Disable rejected" });
    const client = await pool.connect();
    let stopped: Awaited<ReturnType<typeof disableEndpoint>>;
    try {
      await client.query("BEGIN");
      const endpoint = (
        await client.query<{ public_key: Buffer; account_id: string }>(
          `SELECT e.public_key,m.account_id FROM machines m JOIN signin_endpoints e ON e.machine_id=m.id
         WHERE m.id=$1 AND m.revoked_at IS NULL AND m.support_link_id IS NULL
         FOR NO KEY UPDATE OF m FOR UPDATE OF e`,
          [proof.machineId],
        )
      ).rows[0];
      if (
        !endpoint ||
        !validSignature(
          endpoint.public_key,
          signinDisableMessage(proof),
          proof.signature,
        )
      ) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Disable rejected" });
      }
      if (!(await nonce(client, proof.machineId, proof.nonce))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Disable rejected" });
      }
      stopped = await disableEndpoint(client, proof.machineId);
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'signin.authority.locally_disabled')",
        [endpoint.account_id, proof.machineId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await signaling.stopLeases(stopped.leases);
    await Promise.all(stopped.desktop.map((id) => stopDesktop(id)));
    return { ok: true };
  });
  app.post("/api/agent/signin-binding", async (request, reply) => {
    const parsed = signinBinding.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid sign-in binding" });
    if (!enabled && parsed.data.publicKey !== null)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const b = parsed.data;
    if (Math.abs(Date.now() - b.timestamp) > 30_000)
      return reply.code(401).send({ error: "Binding rejected" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const machine = (
        await client.query<{ public_key: Buffer; account_id: string }>(
          "SELECT public_key,account_id FROM machines WHERE id=$1 AND revoked_at IS NULL AND support_link_id IS NULL FOR NO KEY UPDATE",
          [b.machineId],
        )
      ).rows[0];
      if (
        !machine ||
        !validSignature(
          machine.public_key,
          signinBindingMessage(b),
          b.signature,
        )
      ) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Binding rejected" });
      }
      if (!(await nonce(client, b.machineId, b.nonce))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Binding rejected" });
      }
      let disabled: Awaited<ReturnType<typeof disableEndpoint>> | undefined;
      if (b.publicKey) {
        const key = Buffer.from(b.publicKey, "base64");
        const reused = await client.query(
          "SELECT 1 FROM machines WHERE public_key=$1 UNION ALL SELECT 1 FROM boot_agents WHERE public_key=$1 UNION ALL SELECT 1 FROM signin_endpoints WHERE (public_key=$1 AND machine_id<>$2) OR worker_public_key=$1",
          [key, b.machineId],
        );
        if (reused.rowCount) {
          await client.query("ROLLBACK");
          return reply
            .code(400)
            .send({ error: "A separate sign-in identity is required" });
        }
        await client.query(
          `INSERT INTO signin_endpoints(machine_id,public_key,enabled) VALUES ($1,$2,true)
          ON CONFLICT (machine_id) DO UPDATE SET public_key=$2,enabled=true,version=signin_endpoints.version+1,
            instance_id=NULL,console_session_id=NULL,last_seen_at=NULL,state='unavailable',worker_ready=false,worker_public_key=NULL`,
          [b.machineId, key],
        );
      } else {
        disabled = await disableEndpoint(client, b.machineId);
      }
      const stoppedLeases =
        disabled?.leases ?? (await endLeases(client, b.machineId));
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
        [
          machine.account_id,
          b.machineId,
          b.publicKey
            ? "signin.authority.enabled"
            : "signin.authority.disabled",
        ],
      );
      await client.query("COMMIT");
      void signaling.stopLeases(stoppedLeases);
      if (disabled)
        await Promise.all(disabled.desktop.map((id) => stopDesktop(id)));
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/signin/heartbeat", async (request, reply) => {
    if (!enabled)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const parsed = signinHeartbeat.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid sign-in heartbeat" });
    const b = parsed.data;
    if (Math.abs(Date.now() - b.timestamp) > 30_000)
      return reply.code(401).send({ error: "Presence rejected" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Every transition uses the same machine lock as ordinary sessions and revocation.
      const endpoint = (
        await client.query<{
          public_key: Buffer;
          instance_id: string | null;
          console_session_id: string | null;
          worker_public_key: Buffer | null;
        }>(
          `SELECT e.public_key,e.instance_id,e.console_session_id,e.worker_public_key FROM machines m JOIN signin_endpoints e ON e.machine_id=m.id
         WHERE m.id=$1 AND m.revoked_at IS NULL AND m.support_link_id IS NULL AND e.enabled FOR UPDATE OF m,e`,
          [b.machineId],
        )
      ).rows[0];
      if (
        !endpoint ||
        !validSignature(
          endpoint.public_key,
          signinHeartbeatMessage(b),
          b.signature,
        )
      ) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Presence rejected" });
      }
      if (!(await nonce(client, b.machineId, b.nonce))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Presence rejected" });
      }
      const workerKey = b.workerPublicKey
        ? Buffer.from(b.workerPublicKey, "base64")
        : null;
      const keyChanged =
        (endpoint.worker_public_key?.toString("base64") ?? null) !==
        (workerKey?.toString("base64") ?? null);
      const reused = workerKey
        ? await client.query(
            `SELECT 1 FROM machines WHERE public_key=$1 UNION ALL SELECT 1 FROM boot_agents WHERE public_key=$1
         UNION ALL SELECT 1 FROM signin_endpoints WHERE public_key=$1 OR (worker_public_key=$1 AND machine_id<>$2)`,
            [workerKey, b.machineId],
          )
        : null;
      if (
        reused?.rowCount ||
        (b.state === "sign-in" &&
          endpoint.worker_public_key &&
          endpoint.instance_id === b.instanceId &&
          keyChanged)
      ) {
        // A signed but inconsistent identity claim cannot keep old authority
        // alive. Consume the nonce, end grants and require a fresh worker.
        const stoppedLeases = await endLeases(client, b.machineId);
        await client.query(
          "UPDATE signin_endpoints SET worker_ready=false WHERE machine_id=$1",
          [b.machineId],
        );
        await client.query("COMMIT");
        void signaling.stopLeases(stoppedLeases);
        return reply.code(409).send({ error: "Worker identity rejected" });
      }
      const invalidates =
        endpoint.instance_id !== b.instanceId ||
        Number(endpoint.console_session_id) !== b.consoleSessionId ||
        !b.workerReady ||
        keyChanged;
      const stoppedLeases = invalidates
        ? await endLeases(
            client,
            b.machineId,
            b.state === "signed-in" &&
              Number(endpoint.console_session_id) === b.consoleSessionId,
          )
        : [];
      await client.query(
        `UPDATE signin_endpoints SET instance_id=$2,console_session_id=$3,state=$4,worker_ready=$5,last_seen_at=now(),worker_public_key=$6 WHERE machine_id=$1`,
        [
          b.machineId,
          b.instanceId,
          b.consoleSessionId,
          b.state,
          b.workerReady && workerKey !== null,
          workerKey,
        ],
      );
      await client.query(
        "DELETE FROM heartbeat_nonces WHERE machine_id=$1 AND received_at<now()-interval '2 minutes'",
        [b.machineId],
      );
      await client.query("COMMIT");
      if (invalidates) void signaling.stopLeases(stoppedLeases);
      // Presence replies grant no desktop credential or launch authority.
      return b.workerReady && workerKey !== null
        ? { ok: true, mediaEnabled }
        : { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/machines/:id/signin-authority", async (request, reply) => {
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const parsed = pathSchema.safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid computer" });
    const result = await pool.query(
      `SELECT e.enabled,e.state,
      COALESCE(e.enabled AND e.worker_ready AND e.worker_public_key IS NOT NULL AND e.instance_id IS NOT NULL
        AND e.console_session_id BETWEEN 1 AND 4294967294 AND e.state='sign-in' AND e.last_seen_at>now()-interval '15 seconds'
        AND EXISTS (SELECT 1 FROM machine_access p WHERE p.machine_id=m.id AND p.mode='trusted' AND p.allow_control),false) AS "endpointReady"
      FROM machines m LEFT JOIN signin_endpoints e ON e.machine_id=m.id
      WHERE m.id=$1 AND m.account_id=$2 AND m.revoked_at IS NULL AND m.support_link_id IS NULL`,
      [parsed.data.id, account],
    );
    if (!result.rowCount)
      return reply.code(404).send({ error: "Computer unavailable" });
    return {
      enabled: Boolean(result.rows[0].enabled),
      state: result.rows[0].state ?? "unavailable",
      endpointReady: enabled && result.rows[0].endpointReady,
      connectable: mediaEnabled && result.rows[0].endpointReady,
    };
  });

  app.post(
    "/api/machines/:id/signin-authority/disable",
    async (request, reply) => {
      if (request.headers.origin !== config.WEB_ORIGIN)
        return reply.code(403).send({ error: "Origin rejected" });
      const account = await owner(request);
      if (!account) return reply.code(401).send({ error: "Sign in required" });
      const parsed = pathSchema.safeParse(request.params);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid computer" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const machine = await client.query(
          "SELECT 1 FROM machines WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND support_link_id IS NULL FOR NO KEY UPDATE",
          [parsed.data.id, account],
        );
        if (!machine.rowCount) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: "Computer unavailable" });
        }
        const stopped = await disableEndpoint(client, parsed.data.id);
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'signin.authority.disabled')",
          [account, parsed.data.id],
        );
        await client.query("COMMIT");
        void signaling.stopLeases(stopped.leases);
        await Promise.all(stopped.desktop.map((id) => stopDesktop(id)));
        return { ok: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  // This is an authorization reservation for endpoint development, not a media
  // session. The public inventory and viewer must never infer connectability.
  app.post("/api/machines/:id/signin-leases", async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    if (!mediaEnabled)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const parsed = pathSchema.safeParse(request.params);
    if (
      !parsed.success ||
      !z
        .object({})
        .strict()
        .safeParse(request.body ?? {}).success
    )
      return reply.code(400).send({ error: "Invalid sign-in lease" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const endpoint = (
        await client.query<{
          version: string;
          policy_version: number;
          instance_id: string;
          console_session_id: string;
        }>(
          `SELECT e.version,e.instance_id,e.console_session_id,(SELECT version FROM machine_access WHERE machine_id=m.id) AS policy_version FROM machines m JOIN signin_endpoints e ON e.machine_id=m.id
         WHERE m.id=$1 AND m.account_id=$2 AND m.revoked_at IS NULL AND m.support_link_id IS NULL AND e.enabled AND e.worker_ready
           AND EXISTS (SELECT 1 FROM machine_access p WHERE p.machine_id=m.id AND p.mode='trusted' AND p.allow_control)
           AND e.worker_public_key IS NOT NULL
           AND e.state='sign-in' AND e.last_seen_at>now()-interval '15 seconds' FOR UPDATE OF m,e`,
          [parsed.data.id, account],
        )
      ).rows[0];
      if (!endpoint) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Sign-in endpoint unavailable" });
      }
      await client.query(
        "UPDATE signin_leases SET ended_at=now(),ended_reason='expired' WHERE machine_id=$1 AND ended_at IS NULL AND expires_at<=now()",
        [parsed.data.id],
      );
      const busy = await client.query(
        `SELECT 1 FROM signin_leases WHERE machine_id=$1 AND ended_at IS NULL
        UNION ALL SELECT 1 FROM view_sessions WHERE machine_id=$1 AND status IN ('requested','connecting','active') AND expires_at>now()`,
        [parsed.data.id],
      );
      if (busy.rowCount) {
        await client.query("ROLLBACK");
        return reply
          .code(409)
          .send({ error: "A controller is already active" });
      }
      // Bind authority to the exact live browser login, endpoint generation and console.
      // Logging out, rebinding, console switch, or signed-in state cannot inherit it.
      const created = await client.query(
        `INSERT INTO signin_leases(id,machine_id,account_id,browser_token_hash,endpoint_version,instance_id,console_session_id,policy_version,expires_at)
        SELECT $1,$2,$3,b.token_hash,$5,$6,$7,$8,LEAST(now()+interval '15 seconds',b.expires_at) FROM browser_sessions b
        WHERE b.token_hash=$4 AND b.account_id=$3 AND b.expires_at>now() RETURNING id,expires_at`,
        [
          randomUUID(),
          parsed.data.id,
          account,
          digest(request.cookies.remote_session ?? ""),
          endpoint.version,
          endpoint.instance_id,
          endpoint.console_session_id,
          endpoint.policy_version,
        ],
      );
      if (!created.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Sign in required" });
      }
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'signin.lease.requested')",
        [account, parsed.data.id],
      );
      await client.query("COMMIT");
      return {
        id: created.rows[0].id,
        scope: "windows:sign-in",
        expiresAtMillis: created.rows[0].expires_at.getTime(),
        connectable: mediaEnabled,
        files: false,
        clipboard: false,
        audio: false,
        recording: false,
        automation: false,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/signin/leases/:id/renew", async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    if (!mediaEnabled)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const parsed = pathSchema.safeParse(request.params);
    if (
      !parsed.success ||
      !z
        .object({})
        .strict()
        .safeParse(request.body ?? {}).success
    )
      return reply.code(400).send({ error: "Invalid sign-in lease" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the machine before any lease/policy/browser row, matching worker
      // upgrade and transport teardown even when those race this renewal.
      await client.query(
        "SELECT m.id FROM machines m JOIN signin_leases s ON s.machine_id=m.id WHERE s.id=$1 FOR UPDATE OF m",
        [parsed.data.id],
      );
      const current = await client.query(
        `SELECT s.id ${leaseJoins} WHERE s.id=$1 AND s.account_id=$2 AND s.browser_token_hash=$3 AND ${liveLease} FOR UPDATE OF m,e,s,b,p`,
        [parsed.data.id, account, digest(request.cookies.remote_session ?? "")],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Sign-in lease unavailable" });
      }
      const renewed = await client.query(
        `UPDATE signin_leases s SET expires_at=LEAST(now()+interval '15 seconds',s.deadline,b.expires_at)
        FROM browser_sessions b WHERE s.id=$1 AND b.token_hash=s.browser_token_hash RETURNING s.expires_at`,
        [parsed.data.id],
      );
      await client.query("COMMIT");
      return {
        scope: "windows:sign-in",
        expiresAtMillis: renewed.rows[0].expires_at.getTime(),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/signin/leases/:id/stop", async (request, reply) => {
    if (request.headers.origin !== config.WEB_ORIGIN)
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const parsed = pathSchema.safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid sign-in lease" });
    const client = await pool.connect();
    let changed: boolean;
    let desktop: string | undefined;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT m.id FROM machines m JOIN signin_leases s ON s.machine_id=m.id WHERE s.id=$1 AND s.account_id=$2 FOR NO KEY UPDATE OF m",
        [parsed.data.id, account],
      );
      const stopped = await client.query(
        `WITH stopped AS (
      UPDATE signin_leases SET ended_at=COALESCE(ended_at,now()),ended_reason='stopped',handoff_expires_at=NULL
        WHERE id=$1 AND account_id=$2 AND ended_reason IS DISTINCT FROM 'stopped' RETURNING machine_id)
      INSERT INTO audit_events(account_id,machine_id,action) SELECT $2,machine_id,'signin.lease.stopped' FROM stopped RETURNING machine_id`,
        [parsed.data.id, account],
      );
      changed = Boolean(stopped.rowCount);
      desktop =
        (
          await client.query(
            "SELECT handoff_session_id FROM signin_leases WHERE id=$1 AND account_id=$2",
            [parsed.data.id, account],
          )
        ).rows[0]?.handoff_session_id ?? undefined;
      if (desktop)
        await client.query(
          "UPDATE view_sessions SET status='ended' WHERE id=$1 AND status IN ('requested','connecting','active')",
          [desktop],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (changed) await signaling.stopLease(parsed.data.id);
    if (desktop) await stopDesktop(desktop);
    return { ok: true, changed };
  });

  // Discovery conveys no media grant. The endpoint must separately authorize
  // the returned ID, with a fresh proof and nonce, before worker delivery.
  app.post("/api/signin/pending", async (request, reply) => {
    if (!mediaEnabled)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const parsed = signinPendingProof.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid sign-in discovery proof" });
    const proof = parsed.data;
    if (Math.abs(Date.now() - proof.timestamp) > 30_000)
      return reply.code(401).send({ error: "Discovery rejected" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const endpoint = (
        await client.query<{ public_key: Buffer }>(
          `SELECT e.public_key FROM machines m JOIN signin_endpoints e ON e.machine_id=m.id
           WHERE m.id=$1 AND m.revoked_at IS NULL AND e.enabled FOR UPDATE OF m,e`,
          [proof.machineId],
        )
      ).rows[0];
      if (
        !endpoint ||
        !validSignature(
          endpoint.public_key,
          signinPendingProofMessage(proof),
          proof.signature,
        )
      ) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Discovery rejected" });
      }
      if (!(await nonce(client, proof.machineId, proof.nonce))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Discovery rejected" });
      }
      const lease = (
        await client.query<{ id: string }>(
          `SELECT s.id ${leaseJoins}
           WHERE s.machine_id=$1 AND s.instance_id=$2 AND s.console_session_id=$3 AND ${liveLease}
           ORDER BY s.id LIMIT 1`,
          [proof.machineId, proof.instanceId, proof.consoleSessionId],
        )
      ).rows[0];
      // Consume valid proofs even when no current lease matches.
      await client.query("COMMIT");
      reply.header("Cache-Control", "no-store");
      return { leaseId: lease?.id ?? null };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  app.post("/api/signin/authorize", async (request, reply) => {
    if (!mediaEnabled)
      return reply.code(503).send({ error: "Sign-in authority disabled" });
    const parsed = signinLeaseProof.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid sign-in proof" });
    const proof = parsed.data;
    if (Math.abs(Date.now() - proof.timestamp) > 30_000)
      return reply.code(401).send({ error: "Authorization rejected" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const endpoint = (
        await client.query<{ public_key: Buffer }>(
          `SELECT e.public_key FROM machines m JOIN signin_endpoints e ON e.machine_id=m.id
        WHERE m.id=$1 AND m.revoked_at IS NULL AND e.enabled FOR UPDATE OF m,e`,
          [proof.machineId],
        )
      ).rows[0];
      if (
        !endpoint ||
        !validSignature(
          endpoint.public_key,
          signinLeaseProofMessage(proof),
          proof.signature,
        )
      ) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Authorization rejected" });
      }
      if (!(await nonce(client, proof.machineId, proof.nonce))) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Authorization rejected" });
      }
      const lease = (
        await client.query<{ remaining: number; controller: string }>(
          `SELECT
        GREATEST(0,FLOOR(EXTRACT(epoch FROM (LEAST(s.expires_at,s.deadline,b.expires_at,e.last_seen_at+interval '15 seconds')-now()))*1000))::int AS remaining,
        (SELECT email FROM accounts WHERE id=s.account_id) AS controller
        ${leaseJoins} WHERE s.id=$1 AND s.machine_id=$2 AND s.instance_id=$3 AND s.console_session_id=$4 AND ${liveLease}`,
          [
            proof.leaseId,
            proof.machineId,
            proof.instanceId,
            proof.consoleSessionId,
          ],
        )
      ).rows[0];
      // Commit even a refused fresh proof so its nonce cannot be replayed after a state change.
      await client.query("COMMIT");
      if (!lease || lease.remaining <= 0)
        return reply.code(403).send({ error: "Sign-in lease unavailable" });
      return {
        scope: "windows:sign-in",
        id: proof.leaseId,
        instanceId: proof.instanceId,
        consoleSessionId: proof.consoleSessionId,
        remainingMillis: lease.remaining,
        controller: lease.controller,
        files: false,
        clipboard: false,
        audio: false,
        recording: false,
        automation: false,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
