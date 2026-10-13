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
  heartbeatMessage,
  supportMessage,
} from "../../../packages/protocol/src/index.js";

test(
  "a support code is one-time, scoped, and never skips the local approval",
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
      PORT: 3012,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true",
    });
    await app.ready();
    const owner = randomUUID();
    const helper = randomUUID();
    const machine = randomUUID();
    const keys = generateKeyPairSync("ed25519");
    const stranger = generateKeyPairSync("ed25519");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const helperToken = randomBytes(32).toString("base64url");
    const helperHeaders = { origin, cookie: `remote_session=${helperToken}` };
    const signWith = (key: typeof keys.privateKey, message: string) =>
      sign(null, Buffer.from(message), key).toString("base64");
    const requestCode = (
      capability: "desktop:view" | "desktop:control",
      key = keys.privateKey,
    ) => {
      const timestamp = Date.now();
      const nonce = randomUUID();
      return app.inject({
        method: "POST",
        url: "/api/agent/support",
        payload: {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          capability,
          signature: signWith(
            key,
            supportMessage(machine, timestamp, nonce, capability),
          ),
        },
      });
    };
    const beat = async () => {
      const timestamp = Date.now();
      const nonce = randomUUID();
      const response = await app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          signature: signWith(
            keys.privateKey,
            heartbeatMessage(machine, timestamp, nonce),
          ),
        },
      });
      assert.equal(response.statusCode, 200);
      return response.json() as {
        sessions: { id: string; approval: string; controller: string }[];
      };
    };
    let address = 1;
    const claim = (code: string) =>
      app.inject({
        method: "POST",
        url: "/api/support/claim",
        headers: helperHeaders,
        remoteAddress: `198.51.100.${address++}`,
        payload: { code },
      });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture'),($3,$4,'fixture')",
        [owner, `${owner}@example.test`, helper, `${helper}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [digest(helperToken), helper],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Support fixture',$3,now())",
        [
          machine,
          owner,
          keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
        ],
      );
      // Even a computer set to trusted access asks locally for a support session.
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
        [machine],
      );

      // Only the computer itself can create a code.
      assert.equal(
        (await requestCode("desktop:view", stranger.privateKey)).statusCode,
        401,
      );
      const issued = await requestCode("desktop:view");
      assert.equal(issued.statusCode, 200);
      const code = issued.json().code as string;
      assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const stored = await pool.query(
        "SELECT code_hash FROM support_invitations WHERE machine_id=$1",
        [machine],
      );
      assert.equal(stored.rowCount, 1);
      assert.equal(stored.rows[0].code_hash, digest(code.replace("-", "")));
      assert.ok(!JSON.stringify(stored.rows).includes(code.replace("-", "")));

      // A wrong code and no sign-in are refused without saying why.
      assert.equal((await claim("AAAAAAAA")).statusCode, 404);
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/support/claim",
            headers: { origin },
            payload: { code },
          })
        ).statusCode,
        401,
      );

      // A newer code replaces the older one.
      const replaced = await requestCode("desktop:view");
      assert.equal((await claim(code)).statusCode, 404);
      const newer = replaced.json().code as string;

      const claimed = await claim(newer.toLowerCase());
      assert.equal(claimed.statusCode, 200);
      assert.equal(claimed.json().capability, "desktop:view");
      assert.equal(claimed.json().approval, "local");
      const pending = (await beat()).sessions[0]!;
      assert.equal(pending.id, claimed.json().id);
      assert.equal(pending.approval, "local");
      assert.equal(pending.controller, `${helper}@example.test`);

      // One time: the same code cannot be used again, and it gives the helper no standing access.
      assert.equal((await claim(newer)).statusCode, 404);
      const events = await pool.query(
        "SELECT action FROM audit_events WHERE account_id=$1 AND machine_id=$2",
        [owner, machine],
      );
      const actions = events.rows.map((row) => row.action as string);
      assert.ok(actions.includes("support.invitation.created:view"));
      assert.ok(actions.includes("support.invitation.claimed:view"));
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/machines/${machine}/sessions`,
            headers: helperHeaders,
            remoteAddress: `198.51.100.${address++}`,
            payload: { source: "desktop", capability: "desktop:view" },
          })
        ).statusCode,
        404,
      );

      // An expired code is refused.
      await pool.query(
        "UPDATE view_sessions SET status='ended' WHERE machine_id=$1",
        [machine],
      );
      const expiring = (await requestCode("desktop:control")).json()
        .code as string;
      await pool.query(
        "UPDATE support_invitations SET expires_at=now()-interval '1 second' WHERE machine_id=$1",
        [machine],
      );
      assert.equal((await claim(expiring)).statusCode, 404);
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id IN ($1,$2)", [
        owner,
        helper,
      ]);
      await pool.end();
    }
  },
);
