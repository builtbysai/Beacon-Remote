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

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test(
  "a restart is offered only for a computer trusted with control, delivered once to its own heartbeat",
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
      PORT: 3029,
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
    const machine = randomUUID();
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
          signature: sign(
            null,
            Buffer.from(heartbeatMessage(machine, timestamp, nonce)),
            keys.privateKey,
          ).toString("base64"),
        },
      });
      assert.equal(response.statusCode, 200);
      return response.json();
    };
    const restart = (who: typeof owner) =>
      app.inject({
        method: "POST",
        url: `/api/machines/${machine}/restart`,
        headers: who.headers,
        payload: {},
      });
    try {
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Desk',$3)",
        [
          machine,
          owner.id,
          (
            keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
          ).subarray(12),
        ],
      );
      await beat();
      // Attended (the default) is never enough.
      assert.equal((await restart(owner)).statusCode, 409);
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',false)",
        [machine],
      );
      assert.equal((await restart(owner)).statusCode, 409, "trusted view only");
      await pool.query(
        "UPDATE machine_access SET allow_control=true WHERE machine_id=$1",
        [machine],
      );
      assert.equal((await restart(stranger)).statusCode, 409);
      assert.equal((await restart(owner)).statusCode, 200);
      assert.equal((await restart(owner)).statusCode, 429);
      // Delivered once, to the computer's own heartbeat.
      const told = await beat();
      assert.equal(typeof told.restart.id, "string");
      assert.equal((await beat()).restart, null);
      // An offline computer cannot be asked.
      await pool.query(
        "UPDATE machines SET last_seen_at=now()-interval '5 minutes' WHERE id=$1",
        [machine],
      );
      await pool.query("DELETE FROM machine_restarts WHERE machine_id=$1", [
        machine,
      ]);
      assert.equal((await restart(owner)).statusCode, 409);
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [made]);
      await app.close();
      await pool.end();
    }
  },
);
