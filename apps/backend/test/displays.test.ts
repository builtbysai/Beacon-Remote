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
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

test(
  "a session can only target a display the computer reported",
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
      PORT: 3011,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true",
    });
    await app.ready();
    const account = randomUUID();
    const machine = randomUUID();
    const keys = generateKeyPairSync("ed25519");
    const browserToken = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${browserToken}` };
    const displays = [
      { id: "\\\\.\\DISPLAY1", width: 2560, height: 1440, primary: true },
      { id: "\\\\.\\DISPLAY2", width: 1920, height: 1080, primary: false },
    ];
    const beat = async (extra: object = {}) => {
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
          signature: sign(
            null,
            Buffer.from(heartbeatMessage(machine, timestamp, nonce)),
            keys.privateKey,
          ).toString("base64"),
          ...extra,
        },
      });
      return response;
    };
    let address = 1;
    const create = (displayId?: string) =>
      app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers,
        remoteAddress: `198.51.100.${address++}`,
        payload: { source: "desktop", capability: "desktop:view", displayId },
      });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(browserToken).digest("hex"), account],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Displays fixture',$3,now())",
        [
          machine,
          account,
          keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
        ],
      );
      // A malformed display list is refused outright.
      assert.equal(
        (await beat({ displays: [{ ...displays[0], id: "evil" }] })).statusCode,
        400,
      );
      assert.equal((await beat({ displays })).statusCode, 200);
      const listed = (
        await app.inject({ method: "GET", url: "/api/machines", headers })
      ).json().machines[0].displays;
      assert.deepEqual(listed, displays);

      assert.equal((await create("\\\\.\\DISPLAY9")).statusCode, 400);
      const chosen = await create(displays[1]!.id);
      assert.equal(chosen.statusCode, 200);
      const granted = (await beat()).json().sessions[0];
      assert.equal(granted.id, chosen.json().id);
      assert.equal(granted.displayId, displays[1]!.id);
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);
