import { createPublicKey, verify } from "node:crypto";
import type { PoolClient } from "pg";

// All sign-in entry points re-evaluate the same owner/browser/policy/process
// boundary. Stored reservations alone never confer permission to connect.
export const signinLiveLease = `s.ended_at IS NULL AND s.expires_at>now() AND s.deadline>now()
  AND m.revoked_at IS NULL AND m.account_id=s.account_id AND m.support_link_id IS NULL
  AND b.account_id=s.account_id AND b.expires_at>now()
  AND p.mode='trusted' AND p.allow_control AND p.version=s.policy_version
  AND e.enabled AND e.worker_ready AND e.worker_public_key IS NOT NULL AND e.state='sign-in' AND e.last_seen_at>now()-interval '15 seconds'
  AND e.version=s.endpoint_version AND e.instance_id=s.instance_id AND e.console_session_id=s.console_session_id`;
export const signinLeaseJoins = `FROM signin_leases s JOIN machines m ON m.id=s.machine_id
  JOIN signin_endpoints e ON e.machine_id=m.id JOIN browser_sessions b ON b.token_hash=s.browser_token_hash
  JOIN machine_access p ON p.machine_id=m.id`;
// Used by status and ordinary admission under the same machine-first lock.
// A transition grants no access by itself and is consumed exactly once.
export const signinLiveHandoff = `s.ended_reason='handoff' AND s.handoff_expires_at>now() AND s.handoff_session_id IS NULL
  AND s.deadline>now() AND m.revoked_at IS NULL AND m.account_id=s.account_id AND m.support_link_id IS NULL
  AND b.account_id=s.account_id AND b.expires_at>now()
  AND p.mode='trusted' AND p.allow_control AND p.version=s.policy_version
  AND e.enabled AND e.version=s.endpoint_version AND e.state='signed-in' AND e.console_session_id=s.console_session_id
  AND e.last_seen_at>now()-interval '15 seconds'`;
export function signinValidSignature(
  raw: Buffer,
  message: string,
  signature: string,
) {
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
    format: "der",
    type: "spki",
  });
  return verify(
    null,
    Buffer.from(message),
    key,
    Buffer.from(signature, "base64"),
  );
}
export async function consumeSigninNonce(
  client: PoolClient,
  machine: string,
  value: string,
) {
  return Boolean(
    (
      await client.query(
        "INSERT INTO heartbeat_nonces(machine_id,nonce) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [machine, value],
      )
    ).rowCount,
  );
}
