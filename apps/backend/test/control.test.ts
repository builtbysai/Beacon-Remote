import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";

test("production configuration rejects the development control switch", () => {
  assert.throws(
    () =>
      parseConfig({
        DATABASE_URL: "postgresql://localhost/unused",
        WEB_ORIGIN: "https://remote.example.test",
        NODE_ENV: "production",
        SESSION_SECRET: "a".repeat(64),
        DEV_CONTROL_ENABLED: "true",
      }),
    /Development control/,
  );
});

test(
  "control is separately gated, scoped, audited and consumed on disconnect",
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
    const account = randomUUID(),
      stranger = randomUUID(),
      machine = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const alienToken = randomBytes(32).toString("base64url");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const origin = "https://remote.example.test";
    const headers = { origin, cookie: `remote_session=${token}` };
    const config = {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test" as const,
      HOST: "127.0.0.1",
      PORT: 3010,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    };
    let app = await createApp(pool, config);
    const sockets: Awaited<ReturnType<typeof app.injectWS>>[] = [];
    let address = 1;
    const request = (
      capability: string,
      source = "desktop",
      requestHeaders = headers,
    ) =>
      app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers: requestHeaders,
        remoteAddress: `198.51.100.${address++}`,
        payload: { source, capability },
      });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture'),($3,$4,'fixture')",
        [
          account,
          `${account}@example.test`,
          stranger,
          `${stranger}@example.test`,
        ],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')",
        [digest(token), account, digest(alienToken), stranger],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Control fixture',$3,now())",
        [machine, account, randomBytes(32)],
      );
      assert.equal((await request("desktop:control")).statusCode, 403);
      await app.close();
      app = await createApp(pool, { ...config, DEV_CONTROL_ENABLED: "true" });
      await app.ready();
      assert.equal(
        (await request("desktop:control", "synthetic")).statusCode,
        403,
      );
      assert.equal(
        (
          await request("desktop:control", "desktop", {
            ...headers,
            origin: "https://evil.example.test",
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await request("desktop:control", "desktop", {
            origin,
            cookie: `remote_session=${alienToken}`,
          })
        ).statusCode,
        404,
      );
      const created = await request("desktop:control");
      assert.equal(created.statusCode, 200);
      assert.equal(created.json().capability, "desktop:control");
      const id = created.json().id as string;
      assert.equal((await request("desktop:view")).statusCode, 409);
      const session = (
        await pool.query("SELECT * FROM view_sessions WHERE id=$1", [id])
      ).rows[0];
      const { createHmac } = await import("node:crypto");
      const canonical = `beacon-remote:view:v1\n${id}\n${machine}\ndesktop\n${new Date(session.expires_at).getTime()}`;
      const sign = (scope: string) =>
        createHmac("sha256", Buffer.from(config.SESSION_SECRET, "hex"))
          .update(canonical + scope)
          .digest("base64url");
      // A token minted for the same session under view scope cannot claim control.
      await assert.rejects(
        app.injectWS(`/api/sessions/${id}/signal?role=machine`, {
          headers: { authorization: `Bearer ${sign("")}` },
        }),
      );
      const viewer = await app.injectWS(
        `/api/sessions/${id}/signal?role=viewer`,
        { headers },
      );
      sockets.push(viewer);
      const native = await app.injectWS(
        `/api/sessions/${id}/signal?role=machine`,
        { headers: { authorization: `Bearer ${sign("\ndesktop:control")}` } },
      );
      sockets.push(native);
      await assert.rejects(
        app.injectWS(`/api/sessions/${id}/signal?role=viewer`, { headers }),
      );
      const consent = once(viewer, "message", {
        signal: AbortSignal.timeout(3000),
      });
      native.send(
        JSON.stringify({ type: "consent", accepted: true, resumable: true }),
      );
      assert.deepEqual(JSON.parse((await consent)[0].toString()), {
        type: "consent",
        accepted: true,
      });
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM audit_events WHERE account_id=$1 AND action='desktop.control.accepted'",
            [account],
          )
        ).rowCount,
        1,
      );
      const closed = once(native, "close", {
        signal: AbortSignal.timeout(3000),
      });
      viewer.close();
      await closed;
      assert.equal(
        (await pool.query("SELECT status FROM view_sessions WHERE id=$1", [id]))
          .rows[0].status,
        "ended",
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/sessions/${id}/resume`,
            headers,
            payload: {},
          })
        ).statusCode,
        403,
      );
      await assert.rejects(
        app.injectWS(`/api/sessions/${id}/signal?role=machine`, {
          headers: { authorization: `Bearer ${sign("\ndesktop:control")}` },
        }),
      );
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [
        [account, stranger],
      ]);
      await pool.end();
    }
  },
);
