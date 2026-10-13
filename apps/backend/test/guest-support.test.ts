import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "a helper without an account redeems a code as a temporary guest who can only run that support session",
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
      PORT: 3016,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const owner = randomUUID();
    const machine = randomUUID();
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    let address = 1;
    const post = (path: string, payload: object, cookie?: string) =>
      app.inject({
        method: "POST",
        url: path,
        headers: { origin, ...(cookie ? { cookie } : {}) },
        remoteAddress: `192.0.2.${address++}`,
        payload,
      });
    const guestCount = async () =>
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM accounts WHERE guest_expires_at IS NOT NULL AND email LIKE 'guest-%'",
          )
        ).rows[0].count,
      );
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [owner, `${owner}@example.test`],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Grandma PC',$3,now())",
        [
          machine,
          owner,
          generateKeyPairSync("ed25519")
            .publicKey.export({ type: "spki", format: "der" })
            .subarray(-32),
        ],
      );
      const code = "ABCDEFGH";
      await pool.query(
        "INSERT INTO support_invitations(code_hash,machine_id,capability,expires_at) VALUES ($1,$2,'desktop:view',now()+interval '10 minutes')",
        [digest(code), machine],
      );
      const before = await guestCount();

      // A wrong code creates nothing, and the signed-in route still needs an account.
      assert.equal(
        (await post("/api/support/guest", { code: "ZZZZZZZZ" })).statusCode,
        404,
      );
      assert.equal(await guestCount(), before);
      assert.equal(
        (await post("/api/support/claim", { code })).statusCode,
        401,
      );

      const claimed = await post("/api/support/guest", { code });
      assert.equal(claimed.statusCode, 200);
      assert.equal(
        claimed.json().approval,
        "local",
        "the person at the computer still approves",
      );
      assert.equal(claimed.json().machineName, "Grandma PC");
      const cookie = String(claimed.headers["set-cookie"]).split(";")[0]!;
      assert.match(String(claimed.headers["set-cookie"]), /HttpOnly/);
      assert.equal(await guestCount(), before + 1);

      // The guest can see and stop their own session, and nothing else.
      const sessions = await app.inject({
        method: "GET",
        url: "/api/sessions",
        headers: { cookie },
      });
      assert.equal(sessions.statusCode, 200);
      assert.equal(sessions.json().sessions.length, 1);
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/api/machines",
            headers: { cookie },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/enrollments", {}, cookie)).statusCode,
        401,
      );
      assert.equal((await post("/api/mfa/setup", {}, cookie)).statusCode, 401);
      const guest = (
        await pool.query(
          "SELECT email,guest_expires_at FROM accounts WHERE email LIKE 'guest-%' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0];
      assert.equal(
        (await post("/api/login", { email: guest.email, password: "!" }))
          .statusCode,
        401,
      );
      const hours =
        (new Date(guest.guest_expires_at).getTime() - Date.now()) / 3_600_000;
      assert.ok(hours > 3 && hours <= 4, "guest lasts four hours at most");

      // The code is one-time.
      assert.equal(
        (await post("/api/support/guest", { code })).statusCode,
        404,
      );

      const stopped = await post(
        `/api/sessions/${claimed.json().id}/stop`,
        {},
        cookie,
      );
      assert.equal(stopped.statusCode, 200);
    } finally {
      await app.close();
      await pool.query(
        "DELETE FROM accounts WHERE id=$1 OR (guest_expires_at IS NOT NULL AND email LIKE 'guest-%')",
        [owner],
      );
      await pool.end();
    }
  },
);
