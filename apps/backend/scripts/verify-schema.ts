import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const expected: Record<string, string[]> = {
    view_sessions: [
      "id",
      "account_id",
      "machine_id",
      "source",
      "capability",
      "token_hash",
      "expires_at",
      "status",
      "created_at",
      "approval",
      "policy_version",
      "display_id",
      "relationship_id",
    ],
    machine_access: [
      "machine_id",
      "mode",
      "allow_control",
      "version",
      "updated_at",
    ],
    support_relationships: [
      "id",
      "machine_id",
      "helper_account_id",
      "capability",
      "expires_at",
      "created_at",
      "revoked_at",
    ],
    support_invitations: [
      "code_hash",
      "machine_id",
      "capability",
      "expires_at",
      "claimed_at",
      "claimed_by",
      "created_at",
    ],
    account_invitations: ["token_hash", "expires_at", "claimed_at"],
    accounts: ["id", "email", "password_hash", "created_at"],
    browser_sessions: ["token_hash", "account_id", "expires_at"],
    enrollments: ["code_hash", "account_id", "expires_at", "claimed_at"],
    machines: [
      "id",
      "account_id",
      "name",
      "public_key",
      "last_seen_at",
      "revoked_at",
      "created_at",
      "displays",
    ],
    heartbeat_nonces: ["machine_id", "nonce", "received_at"],
    audit_events: ["id", "account_id", "machine_id", "action", "occurred_at"],
  };
  const result = await pool.query<{ table_name: string; column_name: string }>(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",
  );
  const actual = new Set(
    result.rows.map((r) => `${r.table_name}.${r.column_name}`),
  );
  for (const [table, columns] of Object.entries(expected)) {
    for (const column of columns) {
      if (!actual.has(`${table}.${column}`))
        throw new Error(`Missing schema column ${table}.${column}`);
    }
  }
  const duration = await pool.query<{ is_nullable: string }>(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='view_sessions' AND column_name='expires_at'",
  );
  if (duration.rows[0]?.is_nullable !== "YES")
    throw new Error("Missing development session duration migration");
  const requiredConstraints = [
    "view_sessions_pkey",
    "view_sessions_account_id_fkey",
    "view_sessions_machine_id_fkey",
    "view_sessions_source_check",
    "view_sessions_capability_check",
    "view_sessions_control_source",
    "view_sessions_status_check",
    "account_invitations_pkey",
    "accounts_pkey",
    "accounts_email_key",
    "browser_sessions_pkey",
    "browser_sessions_account_id_fkey",
    "enrollments_pkey",
    "enrollments_account_id_fkey",
    "machines_pkey",
    "machines_account_id_fkey",
    "machines_public_key_key",
    "machines_public_key_check",
    "heartbeat_nonces_pkey",
    "heartbeat_nonces_machine_id_fkey",
    "audit_events_pkey",
    "audit_events_account_id_fkey",
    "audit_events_machine_id_fkey",
  ];
  const constraints = await pool.query<{ conname: string }>(
    "SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace",
  );
  const names = new Set(constraints.rows.map((r) => r.conname));
  for (const name of requiredConstraints)
    if (!names.has(name)) throw new Error(`Missing schema constraint ${name}`);
  const sessionIndex = await pool.query(
    "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='view_sessions_one_live_machine' AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL",
  );
  if (!sessionIndex.rowCount)
    throw new Error("Missing active-session uniqueness index");
  const role = await pool.query<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
  }>(
    "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user",
  );
  if (
    process.env.NODE_ENV === "production" &&
    Object.values(role.rows[0]!).some(Boolean)
  )
    throw new Error(
      "Production application role must not administer PostgreSQL",
    );
  console.log("Identity schema and application role verification passed.");
} finally {
  await pool.end();
}
