import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";
import {
  accessMessage,
  heartbeatMessage,
  supportEndMessage,
} from "../../../packages/protocol/src/index.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test(
  "a support link is claimed once, stays within what it offered, and leaves nothing behind when support ends",
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
      PORT: 3025,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true",
    });
    await app.ready();
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
      [id, `${id}@example.test`],
    );
    await pool.query(
      "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
      [sha(token), id],
    );
    const headers = { origin, cookie: `remote_session=${token}` };
    const keys = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    const publicKey = (
      keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
    )
      .subarray(12)
      .toString("base64");
    const signed = (message: string) =>
      sign(null, Buffer.from(message), keys.privateKey).toString("base64");
    const create = (capability: string) =>
      app.inject({
        method: "POST",
        url: "/api/support-links",
        headers,
        payload: { capability, label: "Mum's laptop" },
      });
    const claim = (secret: string) =>
      app.inject({
        method: "POST",
        url: "/api/agent/support-claim",
        payload: { version: 1, token: secret, name: "Mum's PC", publicKey },
      });
    const links = async () =>
      (
        await app.inject({ method: "GET", url: "/api/support-links", headers })
      ).json().links as { id: string; state: string; machineId: string }[];
    const tokenOf = (link: string) => link.slice(link.indexOf("=") + 1);
    try {
      // The link needs a signed-in technician and the web origin.
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/support-links",
            headers: { origin },
            payload: { capability: "desktop:view" },
          })
        ).statusCode,
        401,
      );
      const made = (await create("desktop:view")).json();
      const secret = tokenOf(made.url);
      assert.equal(made.url.startsWith(`${origin}/#support=`), true);
      // The database holds only a hash, never the token.
      assert.equal(
        (
          await pool.query("SELECT 1 FROM support_links WHERE token_hash=$1", [
            secret,
          ])
        ).rowCount,
        0,
      );
      assert.equal((await links())[0]!.state, "waiting");

      // The recipient sees who is asking before downloading anything.
      const preview = await app.inject({
        method: "POST",
        url: "/api/support-invite/preview",
        payload: { token: secret },
      });
      assert.equal(preview.statusCode, 200);
      assert.equal(preview.json().technician, `${id}@example.test`);
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/support-invite/preview",
            payload: { token: randomBytes(24).toString("base64url") },
          })
        ).statusCode,
        404,
      );

      // One claim only: a replay, or a second computer with the same link, is refused.
      const first = await claim(secret);
      assert.equal(first.statusCode, 200);
      const machine = first.json().machineId as string;
      assert.equal(first.json().capability, "desktop:view");
      assert.equal((await claim(secret)).statusCode, 403);
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/support-invite/preview",
            payload: { token: secret },
          })
        ).statusCode,
        404,
      );
      assert.equal((await links())[0]!.state, "offline");

      // It is a temporary computer: it can never raise its own access, and it is not a permanent machine.
      const timestamp = Date.now();
      const nonce = randomUUID();
      const raise = await app.inject({
        method: "POST",
        url: "/api/agent/access",
        payload: {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          mode: "trusted",
          allowControl: false,
          signature: signed(
            accessMessage(machine, timestamp, nonce, "trusted", false),
          ),
        },
      });
      assert.equal(raise.statusCode, 401);
      assert.equal(
        (
          await pool.query("SELECT 1 FROM machine_access WHERE machine_id=$1", [
            machine,
          ])
        ).rowCount,
        0,
      );
      const beat = async () => {
        const stamp = Date.now();
        const once = randomUUID();
        return app.inject({
          method: "POST",
          url: "/api/agent/heartbeat",
          payload: {
            version: 1,
            machineId: machine,
            timestamp: stamp,
            nonce: once,
            signature: signed(heartbeatMessage(machine, stamp, once)),
          },
        });
      };
      assert.equal((await beat()).statusCode, 200);

      // A view link never becomes a control session.
      const control = await app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers,
        payload: { source: "desktop", capability: "desktop:control" },
      });
      assert.equal(control.statusCode, 403);
      const view = await app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers,
        payload: { source: "desktop", capability: "desktop:view" },
      });
      assert.equal(view.statusCode, 200);
      // A control link is allowed to ask for control (the person at the computer still has to allow it).
      assert.equal((await create("desktop:control")).statusCode, 200);

      // The person at the computer ends support: the computer is revoked, its session ends, nothing remains.
      const stamp = Date.now();
      const once = randomUUID();
      const end = await app.inject({
        method: "POST",
        url: "/api/agent/support-end",
        payload: {
          version: 1,
          machineId: machine,
          timestamp: stamp,
          nonce: once,
          signature: signed(supportEndMessage(machine, stamp, once)),
        },
      });
      assert.equal(end.statusCode, 200);
      assert.equal((await beat()).statusCode, 401);
      const row = (
        await pool.query("SELECT revoked_at FROM machines WHERE id=$1", [
          machine,
        ])
      ).rows[0];
      assert.notEqual(row.revoked_at, null);
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM view_sessions WHERE machine_id=$1 AND status IN ('requested','connecting','active')",
            [machine],
          )
        ).rowCount,
        0,
      );
      const ended = (await links()).find((link) => link.machineId === machine);
      assert.equal(ended?.state, "ended");

      // The time limit alone ends a link even if the client never speaks again.
      const second = (await create("desktop:view")).json();
      const claimed = await app.inject({
        method: "POST",
        url: "/api/agent/support-claim",
        payload: {
          version: 1,
          token: tokenOf(second.url),
          name: "Dad's PC",
          publicKey: (
            other.publicKey.export({ format: "der", type: "spki" }) as Buffer
          )
            .subarray(12)
            .toString("base64"),
        },
      });
      assert.equal(claimed.statusCode, 200);
      const signedOther = (message: string) =>
        sign(null, Buffer.from(message), other.privateKey).toString("base64");
      await pool.query(
        "UPDATE machines SET temporary_until=now()-interval '1 minute' WHERE id=$1",
        [claimed.json().machineId],
      );
      const stamp2 = Date.now();
      const once2 = randomUUID();
      const late = await app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          version: 1,
          machineId: claimed.json().machineId,
          timestamp: stamp2,
          nonce: once2,
          signature: signedOther(
            heartbeatMessage(claimed.json().machineId, stamp2, once2),
          ),
        },
      });
      assert.equal(late.statusCode, 401);

      // The technician can cancel a link nobody used, and then it cannot be claimed.
      const unused = (await create("desktop:view")).json();
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/support-links/${unused.id}/end`,
            headers,
          })
        ).statusCode,
        200,
      );
      assert.equal((await claim(tokenOf(unused.url))).statusCode, 403);
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=$1", [id]);
      await app.close();
      await pool.end();
    }
  },
);
