import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { applyMigrations } from "../src/migrations.js";

test("relay configuration rejects partial credentials and unsafe URL formats", () => {
  const env = {
    DATABASE_URL: "postgresql://dev:development@127.0.0.1/beacon_remote_test",
    WEB_ORIGIN: "https://remote.example.test",
    SESSION_SECRET: "a".repeat(64),
    TURN_SECRET: "b".repeat(32),
    TURN_URLS:
      "turn:relay.example.test:3478?transport=udp, turn:backup.example.test:3478?transport=udp",
  };
  assert.equal(parseConfig(env).TURN_URLS?.length, 2);
  assert.equal(
    parseConfig({ ...env, ICE_TRANSPORT_POLICY: "relay" }).ICE_TRANSPORT_POLICY,
    "relay",
  );
  assert.throws(() =>
    parseConfig({
      ...env,
      TURN_URLS: undefined,
      TURN_SECRET: undefined,
      ICE_TRANSPORT_POLICY: "relay",
    }),
  );
  assert.throws(() => parseConfig({ ...env, ICE_TRANSPORT_POLICY: "invalid" }));
  assert.throws(() => parseConfig({ ...env, TURN_SECRET: undefined }));
  assert.throws(() => parseConfig({ ...env, TURN_URLS: undefined }));
  assert.throws(() => parseConfig({ ...env, SESSION_SECRET: undefined }));
  for (const TURN_URLS of [
    "https://relay.example.test",
    "turn:user:password@relay.example.test:3478?transport=udp",
    "turn:relay.example.test:0?transport=udp",
    "turn:relay.example.test:65536?transport=udp",
    "turns:relay.example.test:5349?transport=udp",
    "turns:relay.example.test:5349?transport=tcp",
    "turn:relay.example.test:3478?transport=tcp",
    "turn:relay.example.test:3478?transport=udp&secret=value",
  ])
    assert.throws(() => parseConfig({ ...env, TURN_URLS }));
});

test(
  "relay issuance is owner/origin scoped, deadline bounded and rejects terminated sessions",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const origin = "https://remote.example.test";
    const secret = randomBytes(32).toString("hex");
    const config = parseConfig({
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test",
      SESSION_SECRET: randomBytes(32).toString("hex"),
      TURN_SECRET: secret,
      TURN_URLS: "turn:relay.example.test:3478?transport=udp",
    });
    const app = await createApp(pool, config);
    const disabled = await createApp(pool, {
      ...config,
      TURN_SECRET: undefined,
      TURN_URLS: undefined,
    });
    const account = randomUUID(),
      other = randomUUID(),
      machine = randomUUID(),
      session = randomUUID();
    const browser = randomBytes(32).toString("base64url"),
      alien = randomBytes(32).toString("base64url");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const headers = { origin, cookie: `remote_session=${browser}` };
    let address = 1;
    const request = (
      requestHeaders = headers,
      target = app,
      id: string = session,
      remoteAddress = `198.51.100.${address++}`,
    ) =>
      target.inject({
        method: "POST",
        url: `/api/sessions/${id}/relay`,
        headers: requestHeaders,
        payload: {},
        remoteAddress,
      });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture'),($3,$4,'fixture')",
        [account, `${account}@example.test`, other, `${other}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",
        [digest(browser), account, digest(alien), other],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Relay fixture',$3,now())",
        [machine, account, randomBytes(32)],
      );
      const expiry = new Date(Date.now() + 120000);
      await pool.query(
        "INSERT INTO view_sessions(id,account_id,machine_id,source,token_hash,expires_at,status) VALUES ($1,$2,$3,'synthetic',$4,$5,'requested')",
        [
          session,
          account,
          machine,
          digest(randomBytes(32).toString("hex")),
          expiry,
        ],
      );
      assert.equal((await request({ origin, cookie: "" })).statusCode, 401);
      assert.equal(
        (await request({ ...headers, origin: "https://evil.example.test" }))
          .statusCode,
        403,
      );
      assert.equal(
        (await request({ origin, cookie: `remote_session=${alien}` }))
          .statusCode,
        404,
      );
      assert.equal((await request(headers, app, "invalid")).statusCode, 400);
      assert.equal((await request(headers, disabled)).statusCode, 503);
      for (const status of ["requested", "connecting", "active"]) {
        await pool.query("UPDATE view_sessions SET status=$2 WHERE id=$1", [
          session,
          status,
        ]);
        const response = await request();
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["cache-control"], "no-store");
        const body = response.json();
        assert.equal(
          body.expiresAtMillis,
          Math.floor(expiry.getTime() / 1000) * 1000,
        );
        assert.ok(body.expiresAtMillis <= expiry.getTime());
        assert.deepEqual(body.iceServers, [
          {
            urls: config.TURN_URLS,
            username: `${Math.floor(expiry.getTime() / 1000)}:beacon-remote:${session}`,
            credential: createHmac("sha1", secret)
              .update(
                `${Math.floor(expiry.getTime() / 1000)}:beacon-remote:${session}`,
              )
              .digest("base64"),
          },
        ]);
        assert.ok(!response.body.includes(secret));
        assert.ok(!response.body.includes("@example.test"));
      }
      for (const status of ["ended", "denied"]) {
        await pool.query("UPDATE view_sessions SET status=$2 WHERE id=$1", [
          session,
          status,
        ]);
        assert.equal((await request()).statusCode, 404);
      }
      await pool.query(
        "UPDATE view_sessions SET status='active',expires_at=now()-interval '1 second' WHERE id=$1",
        [session],
      );
      assert.equal((await request()).statusCode, 404);
      await pool.query(
        "UPDATE view_sessions SET expires_at=now()+interval '1 minute' WHERE id=$1",
        [session],
      );
      await pool.query("UPDATE machines SET revoked_at=now() WHERE id=$1", [
        machine,
      ]);
      assert.equal((await request()).statusCode, 404);
      await pool.query("UPDATE machines SET revoked_at=NULL WHERE id=$1", [
        machine,
      ]);
      for (let attempt = 0; attempt < 8; attempt++) {
        assert.equal(
          (await request(headers, app, session, "203.0.113.200")).statusCode,
          200,
        );
      }
      const limited = await request(headers, app, session, "203.0.113.200");
      assert.equal(limited.statusCode, 429);
      assert.ok(!limited.body.includes("credential"));
      await pool.query("DELETE FROM browser_sessions WHERE token_hash=$1", [
        digest(browser),
      ]);
      assert.equal((await request()).statusCode, 401);
      // Existing configuration response and normal grants must not expose the secret.
      const metadata = await app.inject({
        url: "/api/media/config",
        headers: { cookie: `remote_session=${alien}` },
      });
      assert.equal(metadata.statusCode, 200);
      assert.ok(!metadata.body.includes("credential"));
      assert.ok(!metadata.body.includes(secret));
    } finally {
      await app.close();
      await disabled.close();
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [
        [account, other],
      ]);
      await pool.end();
    }
  },
);
