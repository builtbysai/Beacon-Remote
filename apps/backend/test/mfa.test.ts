import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { totp } from "../src/mfa.js";
import { applyMigrations } from "../src/migrations.js";

const decode = (text: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of text) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

test(
  "two-step sign-in: password alone starts no session, codes and recovery codes are one-time, lockout holds",
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
      PORT: 3014,
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
        remoteAddress: `198.51.100.${address++}`,
        payload,
      });
    const cookieOf = (response: { headers: Record<string, unknown> }) =>
      String(response.headers["set-cookie"]).split(";")[0]!;
    const step = (offset = 0) => Math.floor(Date.now() / 1000 / 30) + offset;
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
        [id, email, await hash(password)],
      );
      // Before two-step sign-in a password is enough.
      const first = await post("/api/login", { email, password });
      assert.equal(first.statusCode, 200);
      const session = cookieOf(first);
      const other = cookieOf(await post("/api/login", { email, password }));

      const setup = (await post("/api/mfa/setup", {}, session)).json();
      assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
      const secret = decode(setup.secret as string);
      // The secret is encrypted at rest.
      const stored = (
        await pool.query("SELECT secret FROM account_mfa WHERE account_id=$1", [
          id,
        ])
      ).rows[0].secret as Buffer;
      assert.ok(!stored.includes(secret));

      assert.equal(
        (await post("/api/mfa/enable", { code: "000000" }, session)).statusCode,
        401,
      );
      const enabled = await post(
        "/api/mfa/enable",
        { code: totp(secret, step()) },
        session,
      );
      assert.equal(enabled.statusCode, 200);
      const recovery = enabled.json().recoveryCodes as string[];
      assert.equal(recovery.length, 10);
      // Turning it on signs out the other browsers.
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/api/machines",
            headers: { cookie: other },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/api/machines",
            headers: { cookie: session },
          })
        ).statusCode,
        200,
      );

      // The password alone now starts nothing.
      const challenge = await post("/api/login", { email, password });
      assert.equal(challenge.statusCode, 200);
      assert.equal(challenge.json().mfaRequired, true);
      assert.equal(challenge.headers["set-cookie"], undefined);
      const token = challenge.json().challenge as string;
      assert.equal(
        (
          await post("/api/login/mfa", {
            challenge: token + "x",
            code: totp(secret, step(1)),
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/login/mfa", { challenge: token, code: "123456" }))
          .statusCode,
        401,
      );
      // The code used to turn it on cannot be replayed; the next time step works once.
      assert.equal(
        (
          await post("/api/login/mfa", {
            challenge: token,
            code: totp(secret, step()),
          })
        ).statusCode,
        401,
      );
      const good = await post("/api/login/mfa", {
        challenge: token,
        code: totp(secret, step(1)),
      });
      assert.equal(good.statusCode, 200);
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/api/machines",
            headers: { cookie: cookieOf(good) },
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await post("/api/login/mfa", {
            challenge: token,
            code: totp(secret, step(1)),
          })
        ).statusCode,
        401,
      );

      // A recovery code works once.
      assert.equal(
        (await post("/api/login/mfa", { challenge: token, code: recovery[0]! }))
          .statusCode,
        200,
      );
      assert.equal(
        (await post("/api/login/mfa", { challenge: token, code: recovery[0]! }))
          .statusCode,
        401,
      );

      // Repeated wrong codes lock the account's second step, even for a correct code.
      for (let attempt = 0; attempt < 5; attempt++)
        await post("/api/login/mfa", { challenge: token, code: "654321" });
      assert.equal(
        (await post("/api/login/mfa", { challenge: token, code: recovery[1]! }))
          .statusCode,
        401,
      );
      await pool.query(
        "UPDATE account_mfa SET locked_until=NULL WHERE account_id=$1",
        [id],
      );

      // Turning it off needs the password and a code.
      const wrongPassword = await post(
        "/api/mfa/disable",
        { password: "not-the-password", code: recovery[1]! },
        session,
      );
      assert.equal(wrongPassword.statusCode, 401);
      const off = await post(
        "/api/mfa/disable",
        { password, code: recovery[1]! },
        session,
      );
      assert.equal(off.statusCode, 200);
      assert.equal(
        (await post("/api/login", { email, password })).json().ok,
        true,
      );
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
