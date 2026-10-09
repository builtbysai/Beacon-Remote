import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { z } from "zod";

const email = z.email().parse(process.env.REMOTE_ACCOUNT_EMAIL).toLowerCase();
const password = z
  .string()
  .min(16)
  .max(512)
  .parse(process.env.REMOTE_ACCOUNT_PASSWORD);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [randomUUID(), email, await hash(password)],
  );
  console.log("Account created. No public registration is enabled.");
} finally {
  await pool.end();
}
