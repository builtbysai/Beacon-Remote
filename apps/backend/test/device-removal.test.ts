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
  uninstallMessage,
} from "../../../packages/protocol/src/index.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test(
  "uninstall revokes at once, leaves one bounded instruction for the computer's own key, and ends when it confirms",
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
      PORT: 3026,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const made: string[] = [];
    const person = async () => {
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      made.push(id);
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [id, `${id}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [sha(token), id],
      );
      return { id, headers: { origin, cookie: `remote_session=${token}` } };
    };
    const owner = await person();
    const stranger = await person();
    const keys = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    const machine = randomUUID();
    const publicKey = (
      keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
    ).subarray(12);
    const signWith = (key: typeof keys.privateKey, message: string) =>
      sign(null, Buffer.from(message), key).toString("base64");
    const beat = (key = keys.privateKey) => {
      const timestamp = Date.now();
      const nonce = randomUUID();
      return app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          signature: signWith(key, heartbeatMessage(machine, timestamp, nonce)),
        },
      });
    };
    const done = (key = keys.privateKey) => {
      const timestamp = Date.now();
      const nonce = randomUUID();
      return app.inject({
        method: "POST",
        url: "/api/agent/uninstall-done",
        payload: {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          signature: signWith(key, uninstallMessage(machine, timestamp, nonce)),
        },
      });
    };
    try {
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Desk',$3,now())",
        [machine, owner.id, publicKey],
      );
      assert.equal((await beat()).json().uninstall, undefined);

      // Disconnect keeps the computer; someone else's account cannot touch it.
      const post = (account: typeof owner, path: string) =>
        app.inject({
          method: "POST",
          url: `/api/machines/${machine}/${path}`,
          headers: account.headers,
          payload: {},
        });
      assert.equal((await post(stranger, "disconnect")).statusCode, 404);
      assert.equal((await post(stranger, "uninstall")).statusCode, 404);
      assert.equal((await post(owner, "disconnect")).statusCode, 200);
      assert.equal((await beat()).statusCode, 200);

      // Before the computer confirms, nothing but its own signature gets the instruction.
      const asked = await post(owner, "uninstall");
      assert.equal(asked.statusCode, 200);
      assert.equal(asked.json().online, true);
      assert.equal(
        (
          await pool.query("SELECT revoked_at FROM machines WHERE id=$1", [
            machine,
          ])
        ).rows[0].revoked_at === null,
        false,
      );
      const instruction = await beat();
      assert.equal(instruction.statusCode, 200);
      assert.equal(instruction.json().uninstall, true);
      assert.deepEqual(instruction.json().sessions, []);
      assert.equal((await beat(other.privateKey)).statusCode, 401);
      assert.equal((await done(other.privateKey)).statusCode, 401);

      // It confirms once removed; afterwards it is simply a revoked computer.
      assert.equal((await done()).statusCode, 200);
      assert.equal((await beat()).statusCode, 401);
      const listed = await app.inject({
        method: "GET",
        url: "/api/machines",
        headers: owner.headers,
      });
      const row = listed.json().machines[0];
      assert.equal(row.uninstallPending, false);
      assert.notEqual(row.uninstalledAt, null);

      // The instruction is bounded: after 30 days an old, unconfirmed one is no longer honoured.
      const stale = randomUUID();
      const staleKeys = generateKeyPairSync("ed25519");
      await pool.query(
        `INSERT INTO machines(id,account_id,name,public_key,revoked_at,uninstall_requested_at)
         VALUES ($1,$2,'Old',$3,now(),now()-interval '31 days')`,
        [
          stale,
          owner.id,
          (
            staleKeys.publicKey.export({
              format: "der",
              type: "spki",
            }) as Buffer
          ).subarray(12),
        ],
      );
      const timestamp = Date.now();
      const nonce = randomUUID();
      const late = await app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          version: 1,
          machineId: stale,
          timestamp,
          nonce,
          signature: signWith(
            staleKeys.privateKey,
            heartbeatMessage(stale, timestamp, nonce),
          ),
        },
      });
      assert.equal(late.statusCode, 401);
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [made]);
      await app.close();
      await pool.end();
    }
  },
);
