import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";

test(
  "operator invitations reject expiry/origin/reuse and permit only one concurrent account",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await pool.query(
      await readFile(
        new URL("../migrations/001_identity.sql", import.meta.url),
        "utf8",
      ),
    );
    const origin = "https://remote.example.test";
    const app = await createApp(pool, {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3010,
    });
    const tokens: string[] = [];
    const emails: string[] = [];
    const digest = (token: string) =>
      createHash("sha256").update(token).digest("hex");
    async function invite(expired = false) {
      const token = randomBytes(32).toString("base64url");
      tokens.push(token);
      await pool.query(
        "INSERT INTO account_invitations VALUES ($1,now()+$2::interval,NULL)",
        [digest(token), expired ? "-1 minute" : "30 minutes"],
      );
      return token;
    }
    const setup = (token: string, email: string, requestOrigin = origin) =>
      app.inject({
        method: "POST",
        url: "/api/account/setup",
        remoteAddress: `198.51.100.${emails.length + 1}`,
        headers: { origin: requestOrigin },
        payload: { token, email, password: "test-only-long-account-password" },
      });
    try {
      const email = `${randomUUID()}@example.test`;
      emails.push(email);
      assert.equal((await setup(await invite(true), email)).statusCode, 403);
      const token = await invite();
      assert.equal(
        (await setup(token, email, "https://evil.example.test")).statusCode,
        403,
      );
      const other = `${randomUUID()}@example.test`;
      emails.push(other);
      const responses = await Promise.all([
        setup(token, email),
        setup(token, other),
      ]);
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 403]);
      assert.equal((await setup(token, email)).statusCode, 403);
      const accounts = await pool.query(
        "SELECT email,password_hash FROM accounts WHERE email=ANY($1::text[])",
        [emails],
      );
      assert.equal(accounts.rowCount, 1);
      assert.notEqual(
        accounts.rows[0].password_hash,
        "test-only-long-account-password",
      );
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: {
          email: accounts.rows[0].email,
          password: "test-only-long-account-password",
        },
      });
      assert.equal(login.statusCode, 200);
    } finally {
      await pool.query("DELETE FROM accounts WHERE email=ANY($1::text[])", [
        emails,
      ]);
      await pool.query(
        "DELETE FROM account_invitations WHERE token_hash=ANY($1::text[])",
        [tokens.map(digest)],
      );
      await app.close();
      await pool.end();
    }
  },
);
