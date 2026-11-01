// This route deliberately never calls the interactive heartbeat/session dispatcher.
import { createPublicKey, verify } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  bootBinding,
  bootBindingMessage,
  bootHeartbeat,
  bootHeartbeatMessage,
} from "../../../packages/protocol/src/index.js";

export function registerBootAvailability(
  app: FastifyInstance,
  pool: Pool,
  signedByMachine: (
    id: string,
    message: string,
    signature: string,
  ) => Promise<boolean>,
) {
  app.post("/api/agent/boot-binding", async (request, reply) => {
    const parsed = bootBinding.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid boot binding" });
    const b = parsed.data;
    if (
      Math.abs(Date.now() - b.timestamp) > 30_000 ||
      !(await signedByMachine(
        b.machineId,
        bootBindingMessage(b.machineId, b.timestamp, b.nonce, b.publicKey),
        b.signature,
      ))
    ) {
      return reply.code(401).send({ error: "Binding rejected" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const machine = await client.query<{ account_id: string }>(
        "SELECT account_id FROM machines WHERE id=$1 AND revoked_at IS NULL AND support_link_id IS NULL FOR UPDATE",
        [b.machineId],
      );
      if (!machine.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Binding rejected" });
      }
      const nonce = await client.query(
        "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [b.machineId, b.nonce],
      );
      if (!nonce.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Binding rejected" });
      }
      if (b.publicKey) {
        await client.query(
          `INSERT INTO boot_agents(machine_id,public_key) VALUES ($1,$2)
          ON CONFLICT (machine_id) DO UPDATE SET public_key=$2,last_seen_at=NULL,state='signed-out'`,
          [b.machineId, Buffer.from(b.publicKey, "base64")],
        );
      } else {
        await client.query("DELETE FROM boot_agents WHERE machine_id=$1", [
          b.machineId,
        ]);
      }
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
        [
          machine.rows[0]!.account_id,
          b.machineId,
          b.publicKey ? "machine.boot.enabled" : "machine.boot.disabled",
        ],
      );
      await client.query("COMMIT");
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/api/boot/heartbeat", async (request, reply) => {
    const parsed = bootHeartbeat.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid boot heartbeat" });
    const b = parsed.data;
    if (Math.abs(Date.now() - b.timestamp) > 30_000)
      return reply.code(401).send({ error: "Presence rejected" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Same machine lock as revocation and binding replacement.
      const result = await client.query<{
        public_key: Buffer;
        revoked_at: Date | null;
      }>(
        `SELECT a.public_key,m.revoked_at FROM machines m JOIN boot_agents a ON a.machine_id=m.id
        WHERE m.id=$1 AND m.support_link_id IS NULL FOR UPDATE OF m`,
        [b.machineId],
      );
      const raw = result.rows[0]?.public_key;
      const key =
        raw &&
        createPublicKey({
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            raw,
          ]),
          type: "spki",
          format: "der",
        });
      if (
        !key ||
        !verify(
          null,
          Buffer.from(
            bootHeartbeatMessage(b.machineId, b.timestamp, b.nonce, b.state),
          ),
          key,
          Buffer.from(b.signature, "base64"),
        )
      ) {
        await client.query("ROLLBACK");
        return reply.code(401).send({ error: "Presence rejected" });
      }
      if (result.rows[0]!.revoked_at) {
        await client.query("ROLLBACK");
        return reply.code(410).send({ error: "This computer was removed" });
      }
      const nonce = await client.query(
        "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [b.machineId, b.nonce],
      );
      if (!nonce.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ error: "Presence rejected" });
      }
      await client.query(
        "UPDATE boot_agents SET last_seen_at=now(),state=$2 WHERE machine_id=$1",
        [b.machineId, b.state],
      );
      await client.query(
        "DELETE FROM heartbeat_nonces WHERE machine_id=$1 AND received_at<now()-interval '2 minutes'",
        [b.machineId],
      );
      await client.query("COMMIT");
      return { ok: true }; // No access policy, commands, credentials, or session tokens.
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
