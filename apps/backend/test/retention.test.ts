import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyMigrations } from "../src/migrations.js";
import { purgeStale } from "../src/retention.js";

test(
  "housekeeping removes only long-expired authorisations and finished support links",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const account = randomUUID();
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      const insert = (id: string, claimed: string, ended: string | null) =>
        pool.query(
          `INSERT INTO support_links(id,account_id,token_hash,capability,expires_at,claimed_at,ended_at,ended_by)
           VALUES ($1,$2,$3,'desktop:view',now()+interval '1 day',${claimed},${ended ?? "NULL"},${ended ? "'technician'" : "NULL"})`,
          [id, account, randomBytes(16).toString("hex")],
        );
      const [oldEnded, recentEnded, live] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ];
      await insert(
        oldEnded,
        "now()-interval '41 days'",
        "now()-interval '40 days'",
      );
      await insert(
        recentEnded,
        "now()-interval '2 days'",
        "now()-interval '1 day'",
      );
      await insert(live, "now()", null);
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()-interval '1 minute'),($3,$2,now()+interval '1 hour')",
        [
          randomBytes(16).toString("hex"),
          account,
          randomBytes(16).toString("hex"),
        ],
      );
      await purgeStale(pool);
      const left = (
        await pool.query<{ id: string }>(
          "SELECT id FROM support_links WHERE account_id=$1",
          [account],
        )
      ).rows.map((row) => row.id);
      assert.deepEqual(left.sort(), [recentEnded, live].sort());
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM browser_sessions WHERE account_id=$1",
            [account],
          )
        ).rowCount,
        1,
      );
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);
