import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "a recovery link sets a password once, signs out every browser, and keeps two-step sign-in",
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
    const oldPassword = randomBytes(24).toString("base64url");
    const newPassword = randomBytes(24).toString("base64url");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    let address = 1;
    const post = (path: string, payload: object) =>
      app.inject({
        method: "POST",
        url: path,
        headers: { origin },
        remoteAddress: `198.51.100.${address++}`,
        payload,
      });
    const issue = async (expires = "30 minutes") => {
      const token = randomBytes(32).toString("base64url");
      await pool.query(
        `INSERT INTO account_recoveries VALUES ($1,$2,now()+interval '${expires}',NULL)`,
        [digest(token), id],
      );
      return token;
    };
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
        [id, email, await hash(oldPassword)],
      );
      const before = await post("/api/login", { email, password: oldPassword });
      const session = String(before.headers["set-cookie"]).split(";")[0]!;
      await pool.query(
        "INSERT INTO account_mfa(account_id,secret,enabled_at) VALUES ($1,$2,now())",
        [id, randomBytes(60)],
      );

      // Short passwords and unknown links change nothing.
      const token = await issue();
      assert.equal(
        (await post("/api/account/recover", { token, password: "short" }))
          .statusCode,
        400,
      );
      assert.equal(
        (
          await post("/api/account/recover", {
            token: randomBytes(32).toString("base64url"),
            password: newPassword,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await post("/api/login", { email, password: oldPassword })).statusCode,
        200,
      );

      const done = await post("/api/account/recover", {
        token,
        password: newPassword,
      });
      assert.equal(done.statusCode, 200);
      // The link works once.
      assert.equal(
        (await post("/api/account/recover", { token, password: newPassword }))
          .statusCode,
        403,
      );
      // Every earlier browser is signed out and the old password is dead.
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/api/machines",
            headers: { cookie: session },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/login", { email, password: oldPassword })).statusCode,
        401,
      );
      // The new password still meets the second step.
      const next = await post("/api/login", { email, password: newPassword });
      assert.equal(next.statusCode, 200);
      assert.equal(next.json().mfaRequired, true);
      assert.equal(next.headers["set-cookie"], undefined);

      // An expired link is refused.
      const expired = await issue("1 second");
      await pool.query(
        "UPDATE account_recoveries SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [digest(expired)],
      );
      assert.equal(
        (
          await post("/api/account/recover", {
            token: expired,
            password: oldPassword,
          })
        ).statusCode,
        403,
      );
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
