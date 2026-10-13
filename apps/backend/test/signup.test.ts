import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import type { Mail } from "../src/mail.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "sign-up needs the emailed link, never reveals existing accounts, and recovery by email reuses the one-time link",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const origin = "https://remote.example.test";
    const sent: Mail[] = [];
    const base = {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test" as const,
      HOST: "127.0.0.1",
      PORT: 3017,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    };
    const app = await createApp(
      pool,
      {
        ...base,
        RESEND_API_KEY: "test-key-not-real",
        MAIL_FROM: "Beacon Remote <no-reply@example.test>",
        PUBLIC_SIGNUP: "true",
      },
      { mailer: { send: async (mail) => void sent.push(mail) } },
    );
    await app.ready();
    const address = `${randomUUID()}@example.test`;
    const other = `${randomUUID()}@example.test`;
    const password = randomBytes(24).toString("base64url");
    let remote = 1;
    const post = (path: string, payload: object, cookie?: string) =>
      app.inject({
        method: "POST",
        url: path,
        headers: { origin, ...(cookie ? { cookie } : {}) },
        remoteAddress: `198.18.0.${remote++}`,
        payload,
      });
    const tokenIn = (mail: Mail, name: string) =>
      new RegExp(`#${name}=([A-Za-z0-9_-]{43})`).exec(mail.text)![1]!;
    try {
      assert.equal(
        (await app.inject({ method: "GET", url: "/api/signup/config" })).json()
          .open,
        true,
      );
      assert.equal(
        (await post("/api/signup", { email: address, password: "short" }))
          .statusCode,
        400,
      );

      // New address: one email, no session, and no sign-in until it is confirmed.
      assert.equal(
        (await post("/api/signup", { email: address, password })).statusCode,
        202,
      );
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.to, address);
      const first = tokenIn(sent[0]!, "verify");
      assert.equal(
        (
          await post("/api/login", {
            email: address,
            password: "wrong-password-xx",
          })
        ).statusCode,
        401,
      );
      const early = await post("/api/login", { email: address, password });
      assert.equal(early.statusCode, 403);
      assert.equal(early.json().unverified, true);

      // Signing up again replaces the link (the first one stops working) and the password.
      const again = randomBytes(24).toString("base64url");
      assert.equal(
        (await post("/api/signup", { email: address, password: again }))
          .statusCode,
        202,
      );
      assert.equal(sent.length, 2);
      const second = tokenIn(sent[1]!, "verify");
      assert.notEqual(first, second);
      assert.equal(
        (await post("/api/signup/verify", { token: first })).statusCode,
        403,
      );

      // Resending is limited to once every couple of minutes.
      assert.equal(
        (await post("/api/signup/resend", { email: address })).statusCode,
        202,
      );
      assert.equal(sent.length, 2, "no second email inside the gap");

      const verified = await post("/api/signup/verify", { token: second });
      assert.equal(verified.statusCode, 200);
      assert.match(String(verified.headers["set-cookie"]), /remote_session=/);
      assert.equal(
        (await post("/api/signup/verify", { token: second })).statusCode,
        403,
        "one time",
      );
      assert.equal(
        (await post("/api/login", { email: address, password: again }))
          .statusCode,
        200,
      );

      // An address that already has an account gets a notice, with no link and no duplicate.
      assert.equal(
        (await post("/api/signup", { email: address, password })).statusCode,
        202,
      );
      const notice = sent[sent.length - 1]!;
      assert.ok(!/verify=/.test(notice.text));
      assert.match(notice.text, /already has one/);
      assert.equal(
        Number(
          (
            await pool.query("SELECT count(*) FROM accounts WHERE email=$1", [
              address,
            ])
          ).rows[0].count,
        ),
        1,
      );

      // Recovery by email: unknown address gets the same answer and no mail; a real one gets the link.
      const before = sent.length;
      assert.equal(
        (await post("/api/account/recover/request", { email: other }))
          .statusCode,
        202,
      );
      assert.equal(sent.length, before);
      assert.equal(
        (await post("/api/account/recover/request", { email: address }))
          .statusCode,
        202,
      );
      assert.equal(sent.length, before + 1);
      const recovery = tokenIn(sent[sent.length - 1]!, "recover");
      assert.equal(
        (await post("/api/account/recover/request", { email: address }))
          .statusCode,
        202,
      );
      assert.equal(
        sent.length,
        before + 1,
        "asking again right away sends nothing more",
      );
      const fresh = randomBytes(24).toString("base64url");
      assert.equal(
        (
          await post("/api/account/recover", {
            token: recovery,
            password: fresh,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/login", { email: address, password: again }))
          .statusCode,
        401,
      );
      assert.equal(
        (await post("/api/login", { email: address, password: fresh }))
          .statusCode,
        200,
      );

      // The daily cap closes the door without touching existing accounts.
      const capped = await createApp(
        pool,
        {
          ...base,
          PORT: 3018,
          RESEND_API_KEY: "test-key-not-real",
          MAIL_FROM: "Beacon Remote <no-reply@example.test>",
          PUBLIC_SIGNUP: "true",
          SIGNUPS_PER_DAY: 1,
        },
        { mailer: { send: async (mail) => void sent.push(mail) } },
      );
      await capped.ready();
      const busy = await capped.inject({
        method: "POST",
        url: "/api/signup",
        headers: { origin },
        remoteAddress: "198.18.1.1",
        payload: { email: `${randomUUID()}@example.test`, password },
      });
      assert.equal(busy.statusCode, 503);
      await capped.close();

      // Without a mailer the doors stay shut.
      const closed = await createApp(
        pool,
        { ...base, PORT: 3019 },
        { mailer: null },
      );
      await closed.ready();
      assert.equal(
        (
          await closed.inject({ method: "GET", url: "/api/signup/config" })
        ).json().open,
        false,
      );
      assert.equal(
        (
          await closed.inject({
            method: "POST",
            url: "/api/signup",
            headers: { origin },
            remoteAddress: "198.18.2.1",
            payload: { email: other, password },
          })
        ).statusCode,
        404,
      );
      await closed.close();
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE email IN ($1,$2)", [
        address,
        other,
      ]);
      await pool.end();
    }
  },
);
