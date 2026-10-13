// Operator-only: issue a one-time password recovery link for an account (ADR 0026).
//   create-recovery.js <email> [--reset-mfa]
// --reset-mfa also removes the account's two-step sign-in, for someone who lost both the
// password and the authenticator. Confirm who is asking before running this. Never log the link.
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const [email, ...flags] = process.argv.slice(2);
if (!email) throw new Error("usage: create-recovery <email> [--reset-mfa]");
const origin = new URL(
  process.env.WEB_ORIGIN ?? "https://remote.builtbysai.com",
);
if (origin.protocol !== "https:") throw new Error("HTTPS required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const account = await pool.query<{ id: string }>(
    "SELECT id FROM accounts WHERE lower(email)=lower($1)",
    [email],
  );
  if (!account.rowCount) throw new Error("No account with that email");
  const id = account.rows[0]!.id;
  if (flags.includes("--reset-mfa"))
    await pool.query("DELETE FROM account_mfa WHERE account_id=$1", [id]);
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO account_recoveries VALUES ($1,$2,now()+interval '30 minutes',NULL)",
    [createHash("sha256").update(token).digest("hex"), id],
  );
  console.log(`${origin.origin}/#recover=${token}`);
} finally {
  await pool.end();
}
