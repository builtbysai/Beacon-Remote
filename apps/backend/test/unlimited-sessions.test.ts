import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";

test("unlimited sessions require explicit isolated development configuration", () => {
  const env = {
    DATABASE_URL: "postgresql://localhost/unused",
    WEB_ORIGIN: "http://127.0.0.1:5174",
    SESSION_SECRET: "a".repeat(64),
    DEV_SESSION_UNLIMITED: "true",
  };
  assert.equal(parseConfig(env).DEV_SESSION_UNLIMITED, "true");
  for (const change of [
    { NODE_ENV: "production" },
    { SESSION_SECRET: undefined },
    { WEB_ORIGIN: "https://remote.example.test" },
    {
      TURN_URLS: "turn:relay.example.test:3478?transport=udp",
      TURN_SECRET: "b".repeat(32),
    },
  ])
    assert.throws(
      () => parseConfig({ ...env, ...change }),
      /Unlimited development/,
    );
  assert.equal(
    parseConfig({ ...env, DEV_SESSION_UNLIMITED: undefined })
      .DEV_SESSION_UNLIMITED,
    undefined,
  );
});

test(
  "unlimited accepted sessions renew past the approval budget but pending requests expire and Stop consumes authority",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
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
    const origin = "http://127.0.0.1:5174";
    const secret = randomBytes(32).toString("hex");
    const config = parseConfig({
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test",
      SESSION_SECRET: secret,
      DEV_SESSION_UNLIMITED: "true",
    });
    const app = await createApp(pool, config);
    const account = randomUUID(),
      machine = randomUUID(),
      cookie = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${cookie}` };
    const sockets: Awaited<ReturnType<typeof app.injectWS>>[] = [];
    const create = () =>
      app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers,
        payload: { source: "desktop" },
      });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(cookie).digest("hex"), account],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Unlimited fixture',$3,now())",
        [machine, account, randomBytes(32)],
      );
      const response = await create();
      assert.equal(response.statusCode, 200);
      const grant = response.json();
      assert.equal(grant.expiresAtMillis, 0);
      assert.equal(
        (await app.inject({ url: "/api/media/config", headers })).json()
          .maxSeconds,
        null,
      );
      const bearer = createHmac("sha256", Buffer.from(secret, "hex"))
        .update(`beacon-remote:view:v1\n${grant.id}\n${machine}\ndesktop\n0`)
        .digest("base64url");
      const viewer = await app.injectWS(
        `/api/sessions/${grant.id}/signal?role=viewer`,
        { headers },
      );
      sockets.push(viewer);
      const native = await app.injectWS(
        `/api/sessions/${grant.id}/signal?role=machine`,
        { headers: { authorization: `Bearer ${bearer}` } },
      );
      sockets.push(native);
      const consent = once(viewer, "message", {
        signal: AbortSignal.timeout(3000),
      });
      native.send(JSON.stringify({ type: "consent", accepted: true }));
      assert.equal(JSON.parse((await consent)[0].toString()).accepted, true);
      await pool.query(
        "UPDATE view_sessions SET created_at=now()-interval '1 day' WHERE id=$1",
        [grant.id],
      );
      const lease = once(native, "message", {
        signal: AbortSignal.timeout(3000),
      });
      native.send(JSON.stringify({ type: "renew", nonce: "1" }));
      assert.deepEqual(JSON.parse((await lease)[0].toString()), {
        type: "lease",
        nonce: "1",
        maxAgeMs: 3000,
        expiresAtMillis: 0,
      });
      const history = (
        await app.inject({ url: "/api/sessions", headers })
      ).json().sessions;
      assert.equal(history[0].status, "active");
      assert.equal(history[0].expiresAt, null);
      const ended = once(native, "close", {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/sessions/${grant.id}/stop`,
            headers,
            payload: {},
          })
        ).statusCode,
        200,
      );
      await ended;
      await assert.rejects(
        app.injectWS(`/api/sessions/${grant.id}/signal?role=machine`, {
          headers: { authorization: `Bearer ${bearer}` },
        }),
      );
      const pending = await create();
      assert.equal(pending.statusCode, 200);
      await pool.query(
        "UPDATE view_sessions SET created_at=now()-interval '121 seconds' WHERE id=$1",
        [pending.json().id],
      );
      await assert.rejects(
        app.injectWS(`/api/sessions/${pending.json().id}/signal?role=viewer`, {
          headers,
        }),
      );
      const expiredHistory = (
        await app.inject({ url: "/api/sessions", headers })
      ).json().sessions;
      assert.equal(
        expiredHistory.find(
          (session: { id: string }) => session.id === pending.json().id,
        ).status,
        "expired",
      );
      const fresh = await create();
      assert.equal(fresh.statusCode, 200);
      // The nullable database migration does not authorize unlimited grants on
      // an ordinary backend, even if a record is marked active.
      await pool.query("UPDATE view_sessions SET status='active' WHERE id=$1", [
        fresh.json().id,
      ]);
      const ordinary = await createApp(pool, {
        ...config,
        DEV_SESSION_UNLIMITED: undefined,
      });
      try {
        await ordinary.ready();
        await assert.rejects(
          ordinary.injectWS(
            `/api/sessions/${fresh.json().id}/signal?role=viewer`,
            { headers },
          ),
        );
        const ordinaryHistory = (
          await ordinary.inject({ url: "/api/sessions", headers })
        ).json().sessions;
        assert.equal(
          ordinaryHistory.find(
            (session: { id: string }) => session.id === fresh.json().id,
          ).status,
          "expired",
        );
      } finally {
        await ordinary.close();
      }
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);
