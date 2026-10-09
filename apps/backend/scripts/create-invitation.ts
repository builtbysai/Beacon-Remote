import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const origin = new URL(
  process.env.WEB_ORIGIN ?? "https://remote.builtbysai.com",
);
if (origin.protocol !== "https:") throw new Error("HTTPS required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO account_invitations VALUES ($1,now()+interval '30 minutes',NULL)",
    [createHash("sha256").update(token).digest("hex")],
  );
  // Operator-only bearer invitation. Never log or publish this output.
  console.log(`${origin.origin}/#invite=${token}`);
} finally {
  await pool.end();
}
