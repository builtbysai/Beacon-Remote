import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyMigrations } from "../src/migrations.js";

test(
  "account reset clears the paused acceptance schema without requiring new migrations",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.match(url.pathname, /_test$/);
    const admin = new Pool({ connectionString: url.toString() });
    const name = `beacon_remote_reset_${randomUUID().replaceAll("-", "")}_test`;
    let created = false;
    let pool: Pool | undefined;
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      url.pathname = `/${name}`;
      pool = new Pool({ connectionString: url.toString(), max: 1 });
      for (const migration of ["001_identity.sql", "002_view_sessions.sql"])
        await pool.query(
          await readFile(
            new URL(`../migrations/${migration}`, import.meta.url),
            "utf8",
          ),
        );
      const client = await pool.connect();
      try {
        const account = randomUUID(),
          machine = randomUUID();
        await client.query(
          "INSERT INTO accounts(id,email,password_hash) VALUES ($1,'legacy@example.test','fixture')",
          [account],
        );
        await client.query(
          "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'legacy',decode(repeat('03',32),'hex'))",
          [machine, account],
        );
        await client.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'machine.enrolled')",
          [account, machine],
        );
        await client.query(
          "INSERT INTO view_sessions(id,account_id,machine_id,source,token_hash,expires_at,status) VALUES ($1,$2,$3,'desktop','retired-fixture',now()+interval '1 minute','active')",
          [randomUUID(), account, machine],
        );
        await client.query(
          "INSERT INTO account_invitations(token_hash,expires_at) VALUES ('legacy-invitation',now()+interval '1 hour')",
        );
        await client.query(
          "SELECT set_config('beacon.account_reset_database',$1,false),set_config('beacon.account_reset_recovery','RESTORE_VERIFIED',false)",
          [name],
        );
        await client.query(
          await readFile(
            new URL("../scripts/reset-account-data.sql", import.meta.url),
            "utf8",
          ),
        );
        for (const table of [
          "accounts",
          "machines",
          "audit_events",
          "view_sessions",
          "account_invitations",
        ])
          assert.equal(
            (
              await client.query(
                `SELECT count(*)::int AS count FROM public.${table}`,
              )
            ).rows[0].count,
            0,
          );
      } finally {
        client.release();
      }
    } finally {
      await pool?.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
);

test(
  "account reset is scoped, atomic and clears independent invitations plus sign-in authority",
  {
    skip: !process.env.TEST_DATABASE_URL,
  },
  async () => {
    const source = new URL(process.env.TEST_DATABASE_URL!);
    assert.equal(source.hostname, "127.0.0.1");
    assert.match(source.pathname, /_test$/);
    const admin = new Pool({ connectionString: source.toString() });
    const name = `beacon_remote_reset_${randomUUID().replaceAll("-", "")}_test`;
    const sql = await readFile(
      new URL("../scripts/reset-account-data.sql", import.meta.url),
      "utf8",
    );
    let created = false;
    let pool: Pool | undefined;
    try {
      // Refuse any existing database; cleanup is tied to successful creation.
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      source.pathname = `/${name}`;
      pool = new Pool({ connectionString: source.toString(), max: 1 });
      await applyMigrations(pool);
      const client = await pool.connect();
      try {
        const account = randomUUID(),
          machine = randomUUID(),
          browser = "fixture-browser";
        await client.query(
          "INSERT INTO accounts(id,email,password_hash) VALUES ($1,'reset@example.test','fixture')",
          [account],
        );
        await client.query(
          "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'fixture',decode(repeat('01',32),'hex'))",
          [machine, account],
        );
        await client.query(
          "INSERT INTO browser_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
          [browser, account],
        );
        await client.query(
          "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
          [machine],
        );
        await client.query(
          "INSERT INTO signin_endpoints(machine_id,public_key,enabled) VALUES ($1,decode(repeat('02',32),'hex'),true)",
          [machine],
        );
        await client.query(
          "INSERT INTO signin_leases(id,machine_id,account_id,browser_token_hash,endpoint_version,policy_version,instance_id,console_session_id,expires_at) VALUES ($1,$2,$3,$4,1,1,$5,1,now()+interval '10 seconds')",
          [randomUUID(), machine, account, browser, randomUUID()],
        );
        await client.query(
          "INSERT INTO account_invitations(token_hash,expires_at) VALUES ('unlinked-invitation',now()+interval '1 hour')",
        );
        const unchanged = async () => {
          const row = (
            await client.query(
              "SELECT (SELECT count(*)::int FROM accounts) AS accounts, (SELECT count(*)::int FROM account_invitations) AS invitations, (SELECT count(*)::int FROM signin_leases) AS leases",
            )
          ).rows[0];
          assert.deepEqual(row, { accounts: 1, invitations: 1, leases: 1 });
        };
        const refused = async (pattern: RegExp) => {
          await assert.rejects(client.query(sql), pattern);
          await client.query("ROLLBACK");
          await unchanged();
        };
        await refused(/explicit Beacon Remote database/);
        await client.query(
          "SELECT set_config('beacon.account_reset_database',$1,false)",
          [name],
        );
        await refused(/verified encrypted recovery/);
        await client.query(
          "SELECT set_config('beacon.account_reset_recovery','RESTORE_VERIFIED',false)",
        );
        await client.query("CREATE TABLE public.unreviewed_data(value text)");
        await refused(/unexpected or incomplete/);
        await client.query("DROP TABLE public.unreviewed_data");
        await client.query(
          "CREATE SCHEMA separate_product; CREATE TABLE separate_product.dependency(id uuid REFERENCES public.accounts(id) ON DELETE CASCADE)",
        );
        await client.query(
          "INSERT INTO separate_product.dependency VALUES ($1)",
          [account],
        );
        await refused(/cross-scope dependencies/);
        await client.query("DROP TABLE separate_product.dependency");
        // A malformed historical FK leaves data behind. Verify rollback after
        // deletions, including the independent invitation deletion.
        await client.query(
          "ALTER TABLE public.signin_leases DROP CONSTRAINT signin_leases_machine_id_fkey, DROP CONSTRAINT signin_leases_account_id_fkey, DROP CONSTRAINT signin_leases_browser_token_hash_fkey",
        );
        await refused(/related data remained/);
        await client.query(
          "ALTER TABLE public.signin_leases ADD CONSTRAINT signin_leases_account_id_fkey FOREIGN KEY(account_id) REFERENCES public.accounts(id) ON DELETE CASCADE",
        );
        await client.query(sql);
        for (const table of [
          "accounts",
          "account_invitations",
          "machines",
          "browser_sessions",
          "signin_endpoints",
          "signin_leases",
        ])
          assert.equal(
            (
              await client.query(
                `SELECT count(*)::int AS count FROM public.${table}`,
              )
            ).rows[0].count,
            0,
          );
        // Re-running an empty reset is safe; schema and a separate product survive.
        await client.query(sql);
        assert.equal(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM pg_namespace WHERE nspname='separate_product'",
            )
          ).rows[0].count,
          1,
        );
      } finally {
        client.release();
      }
    } finally {
      await pool?.end();
      if (created) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  },
);
