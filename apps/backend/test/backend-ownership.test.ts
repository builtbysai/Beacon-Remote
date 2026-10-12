import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Pool } from "pg";

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test(
  "duplicate backend preserves live grants; lost ownership stops the owner before replacement recovery",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const schema = `ownership_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: url });
    const pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    const children: ChildProcess[] = [];
    await admin.query(`CREATE SCHEMA ${schema}`);
    try {
      for (const file of [
        "001_identity.sql",
        "002_view_sessions.sql",
        "003_control_scope.sql",
        "004_development_session_duration.sql",
      ])
        await pool.query(
          await readFile(
            new URL(`../migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      const childUrl = new URL(url);
      childUrl.searchParams.set("options", `-c search_path=${schema}`);
      function start(port: number) {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "src/index.ts"],
          {
            cwd: new URL("../", import.meta.url),
            env: {
              ...process.env,
              DATABASE_URL: childUrl.href,
              NODE_ENV: "test",
              HOST: "127.0.0.1",
              PORT: String(port),
              WEB_ORIGIN: "https://remote.example.test",
              SESSION_SECRET: randomBytes(32).toString("hex"),
              TURN_URLS: undefined,
              TURN_SECRET: undefined,
              ICE_TRANSPORT_POLICY: undefined,
            },
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        children.push(child);
        let contention = false;
        let lost = false;
        child.stderr!.on("data", (data: Buffer) => {
          const message = data.toString();
          contention ||= message.includes("Another Beacon Remote backend owns");
          lost ||= message.includes("Backend database ownership lost");
        });
        const exited = new Promise<number | null>((resolve, reject) => {
          child.once("exit", resolve);
          child.once("error", reject);
        });
        async function waitForExit() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              exited,
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                  () => reject(new Error("fixture backend did not exit")),
                  8000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
        async function ready() {
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline) {
            assert.equal(child.exitCode, null, "fixture backend exited early");
            try {
              const response = await fetch(`http://127.0.0.1:${port}/ready`, {
                signal: AbortSignal.timeout(500),
              });
              if (response.ok) return;
            } catch {
              // Wait only for this fixture's bounded startup.
            }
            await delay(50);
          }
          assert.fail("fixture backend did not become ready");
        }
        return {
          ready,
          waitForExit,
          contention: () => contention,
          lost: () => lost,
        };
      }
      const first = start(await unusedPort());
      await first.ready();
      const account = randomUUID();
      const machine = randomUUID();
      const session = randomUUID();
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Ownership fixture',$3)",
        [machine, account, randomBytes(32)],
      );
      await pool.query(
        "INSERT INTO view_sessions(id,account_id,machine_id,source,token_hash,expires_at,status) VALUES ($1,$2,$3,'synthetic','fixture',now()+interval '2 minutes','active')",
        [session, account, machine],
      );
      // Use a different listening port: exclusivity must be database-scoped.
      const duplicate = start(await unusedPort());
      assert.equal(await duplicate.waitForExit(), 1);
      assert.ok(duplicate.contention());
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            session,
          ])
        ).rows[0].status,
        "active",
      );
      assert.equal(
        (await pool.query("SELECT 1 FROM audit_events")).rowCount,
        0,
      );
      await first.ready();

      const owners = await admin.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='beacon-remote-owner'",
      );
      assert.equal(owners.rowCount, 1);
      assert.equal(
        (
          await admin.query("SELECT pg_terminate_backend($1) AS stopped", [
            owners.rows[0]!.pid,
          ])
        ).rows[0].stopped,
        true,
      );
      assert.equal(await first.waitForExit(), 1);
      assert.ok(first.lost());
      const replacement = start(await unusedPort());
      await replacement.ready();
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            session,
          ])
        ).rows[0].status,
        "ended",
      );
      assert.equal(
        (await pool.query("SELECT action FROM audit_events")).rows[0].action,
        "desktop.view.interrupted:backend-restart",
      );
    } finally {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exited = new Promise<void>((resolve) =>
            child.once("exit", () => resolve()),
          );
          child.kill();
          await exited;
        }),
      );
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
