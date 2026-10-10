import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { endInterruptedSessions } from "../src/sessions.js";

test(
  "backend restart ends interrupted grants and permits fresh authorization",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const admin = new Pool({ connectionString: url });
    const schema = `restart_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      for (const file of ["001_identity.sql", "002_view_sessions.sql"])
        await pool.query(
          await readFile(
            new URL(`../migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      const account = randomUUID();
      const browserToken = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(browserToken).digest("hex"), account],
      );
      const rows: { id: string; machine: string; status: string }[] = [];
      for (const status of [
        "requested",
        "connecting",
        "active",
        "denied",
        "ended",
      ]) {
        const machine = randomUUID();
        const id = randomUUID();
        await pool.query(
          "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Restart fixture',$3,now())",
          [machine, account, randomBytes(32)],
        );
        await pool.query(
          "INSERT INTO view_sessions(id,account_id,machine_id,source,token_hash,expires_at,status) VALUES ($1,$2,$3,'synthetic',$4,now()+interval '2 minutes',$5)",
          [id, account, machine, "fixture", status],
        );
        rows.push({ id, machine, status });
      }
      // Recovery and its audit are atomic; a storage failure must fail startup.
      await pool.query(`CREATE FUNCTION reject_restart_audit() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$`);
      await pool.query(`CREATE TRIGGER reject_restart_audit BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_restart_audit()`);
      await assert.rejects(endInterruptedSessions(pool));
      assert.equal(
        (await pool.query("SELECT 1 FROM view_sessions WHERE status='active'"))
          .rowCount,
        1,
      );
      await pool.query("DROP TRIGGER reject_restart_audit ON audit_events");
      await endInterruptedSessions(pool);
      await endInterruptedSessions(pool);
      assert.equal(
        (await pool.query("SELECT 1 FROM audit_events")).rowCount,
        3,
      );
      const origin = "https://remote.example.test";
      app = await createApp(pool, {
        DATABASE_URL: url,
        WEB_ORIGIN: origin,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: 3010,
        SESSION_SECRET: randomBytes(32).toString("hex"),
      });
      await app.ready();
      const headers = { origin, cookie: `remote_session=${browserToken}` };
      for (const row of rows) {
        const status = (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            row.id,
          ])
        ).rows[0].status;
        assert.equal(status, row.status === "denied" ? "denied" : "ended");
        await assert.rejects(
          app.injectWS(`/api/sessions/${row.id}/signal?role=viewer`, {
            headers,
          }),
        );
      }
      const fresh = await app.inject({
        method: "POST",
        url: `/api/machines/${rows[2]!.machine}/sessions`,
        headers,
        payload: { source: "synthetic" },
      });
      assert.equal(fresh.statusCode, 200);
      assert.notEqual(fresh.json().id, rows[2]!.id);
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            fresh.json().id,
          ])
        ).rows[0].status,
        "requested",
      );
    } finally {
      await app?.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
