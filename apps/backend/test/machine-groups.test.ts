import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "a computer can be given a group, keeps it when only renamed, and clears it with an empty one",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const origin = "https://remote.example.test";
    const app = await createApp(pool, {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3021,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const account = randomUUID();
    const machine = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${token}` };
    const rename = (payload: object) =>
      app.inject({
        method: "POST",
        url: `/api/machines/${machine}/name`,
        headers,
        payload,
      });
    const group = async () =>
      (
        await app.inject({ method: "GET", url: "/api/machines", headers })
      ).json().machines[0].group;
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), account],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Desk',$3)",
        [machine, account, randomBytes(32)],
      );
      assert.equal(await group(), null);
      assert.equal(
        (await rename({ name: "Desk", group: " Office " })).statusCode,
        200,
      );
      assert.equal(await group(), "Office");
      // Renaming without a group leaves it alone.
      assert.equal((await rename({ name: "Front desk" })).statusCode, 200);
      assert.equal(await group(), "Office");
      assert.equal(
        (await rename({ name: "Front desk", group: "" })).statusCode,
        200,
      );
      assert.equal(await group(), null);
      assert.equal(
        (await rename({ name: "Desk", group: "x".repeat(41) })).statusCode,
        400,
      );
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);
