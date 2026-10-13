import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "export and deletion need the password again; deletion removes the account and everything under it",
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
      PORT: 3015,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const id = randomUUID();
    const email = `${id}@example.test`;
    const password = randomBytes(24).toString("base64url");
    let address = 1;
    const post = (path: string, payload: object, cookie?: string) =>
      app.inject({
        method: "POST",
        url: path,
        headers: { origin, ...(cookie ? { cookie } : {}) },
        remoteAddress: `203.0.113.${address++}`,
        payload,
      });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
        [id, email, await hash(password)],
      );
      const machine = randomUUID();
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Studio',$3)",
        [machine, id, randomBytes(32)],
      );
      const login = await post("/api/login", { email, password });
      const session = String(login.headers["set-cookie"]).split(";")[0]!;

      assert.equal(
        (await post("/api/account/export", { password })).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/account/export", { password: "wrong" }, session))
          .statusCode,
        401,
      );
      const exported = await post("/api/account/export", { password }, session);
      assert.equal(exported.statusCode, 200);
      assert.match(
        String(exported.headers["content-disposition"]),
        /attachment/,
      );
      const data = JSON.parse(exported.body);
      assert.equal(data.account.email, email);
      assert.equal(data.computers[0].name, "Studio");
      assert.ok(!exported.body.includes("password_hash"));
      assert.ok(!exported.body.includes("public_key"));

      // Deleting needs the explicit word as well as the password.
      assert.equal(
        (await post("/api/account/delete", { password }, session)).statusCode,
        400,
      );
      assert.equal(
        (
          await post(
            "/api/account/delete",
            { password: "wrong", confirm: "DELETE" },
            session,
          )
        ).statusCode,
        401,
      );
      const removed = await post(
        "/api/account/delete",
        { password, confirm: "DELETE" },
        session,
      );
      assert.equal(removed.statusCode, 200);
      for (const table of ["accounts", "machines", "browser_sessions"]) {
        const column =
          table === "accounts"
            ? "id"
            : table === "machines"
              ? "account_id"
              : "account_id";
        const left = await pool.query(
          `SELECT 1 FROM ${table} WHERE ${column}=$1`,
          [id],
        );
        assert.equal(left.rowCount, 0, `${table} rows removed`);
      }
      assert.equal(
        (await post("/api/login", { email, password })).statusCode,
        401,
      );
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
