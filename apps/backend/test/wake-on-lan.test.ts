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
  "an offline computer is woken only by another of its owner's online computers on the same network",
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
      PORT: 3028,
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
    const lan = "0123456789abcdef";
    const computer = async (account: string, name: string) => {
      const keys = generateKeyPairSync("ed25519");
      const id = randomUUID();
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,$3,$4)",
        [
          id,
          account,
          name,
          (
            keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
          ).subarray(12),
        ],
      );
      const beat = async (network?: { macs: string[]; lan: string }) => {
        const timestamp = Date.now();
        const nonce = randomUUID();
        const response = await app.inject({
          method: "POST",
          url: "/api/agent/heartbeat",
          payload: {
            version: 1,
            machineId: id,
            timestamp,
            nonce,
            signature: sign(
              null,
              Buffer.from(heartbeatMessage(id, timestamp, nonce)),
              keys.privateKey,
            ).toString("base64"),
            ...(network ? { network } : {}),
          },
        });
        assert.equal(response.statusCode, 200);
        return response.json();
      };
      return { id, beat };
    };
    const list = async (who: typeof owner) =>
      (
        await app.inject({
          method: "GET",
          url: "/api/machines",
          headers: who.headers,
        })
      ).json().machines as { id: string; canWake: boolean }[];
    const wakeRequest = (who: typeof owner, id: string) =>
      app.inject({
        method: "POST",
        url: `/api/machines/${id}/wake`,
        headers: who.headers,
        payload: {},
      });
    const mac = "AA:BB:CC:DD:EE:01";
    try {
      const sleeper = await computer(owner.id, "Sleeper");
      const neighbour = await computer(owner.id, "Neighbour");
      const elsewhere = await computer(owner.id, "Elsewhere");
      const foreign = await computer(stranger.id, "Foreign");
      await sleeper.beat({ macs: [mac], lan });
      await neighbour.beat({ macs: ["AA:BB:CC:DD:EE:02"], lan });
      await elsewhere.beat({
        macs: ["AA:BB:CC:DD:EE:03"],
        lan: "f".repeat(16),
      });
      await foreign.beat({ macs: ["AA:BB:CC:DD:EE:04"], lan });
      // A computer that is online is not woken.
      assert.equal((await wakeRequest(owner, sleeper.id)).statusCode, 409);
      await pool.query(
        "UPDATE machines SET last_seen_at=now()-interval '10 minutes' WHERE id=$1",
        [sleeper.id],
      );
      const row = (await list(owner)).find((entry) => entry.id === sleeper.id)!;
      assert.equal(row.canWake, true);

      // Another account's computer cannot ask, and cannot be the one that sends.
      assert.equal((await wakeRequest(stranger, sleeper.id)).statusCode, 404);
      // A different network, with nobody awake on it, cannot be woken.
      await pool.query(
        "UPDATE machines SET last_seen_at=now()-interval '10 minutes' WHERE id=$1",
        [neighbour.id],
      );
      assert.equal((await wakeRequest(owner, sleeper.id)).statusCode, 409);
      assert.equal(
        (await list(owner)).find((entry) => entry.id === sleeper.id)!.canWake,
        false,
      );
      await neighbour.beat();

      const asked = await wakeRequest(owner, sleeper.id);
      assert.equal(asked.statusCode, 200);
      assert.equal(asked.json().via, "Neighbour");
      assert.equal((await wakeRequest(owner, sleeper.id)).statusCode, 429);
      // Only the neighbour is told, once, with the hardware address to wake.
      assert.deepEqual((await elsewhere.beat()).wake, []);
      assert.deepEqual((await foreign.beat()).wake, []);
      const told = (await neighbour.beat()).wake as { mac: string }[];
      assert.deepEqual(
        told.map((item) => item.mac),
        [mac],
      );
      assert.deepEqual((await neighbour.beat()).wake, []);
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [made]);
      await app.close();
      await pool.end();
    }
  },
);
