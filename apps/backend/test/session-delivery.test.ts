import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

test(
  "signed long polls deliver fresh requests without holding database connections or repeating handled grants",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url, max: 1 });
    for (const file of [
      "001_identity.sql",
      "002_view_sessions.sql",
      "003_control_scope.sql",
    ])
      await pool.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const account = randomUUID(),
      machine = randomUUID(),
      other = randomUUID();
    const keys = generateKeyPairSync("ed25519");
    const token = randomBytes(32).toString("base64url");
    const origin = "https://remote.example.test";
    const app = await createApp(pool, {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3010,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    const aborters: AbortController[] = [];
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), account],
      );
      for (const id of [machine, other])
        await pool.query(
          "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Delivery fixture',$3,now())",
          [
            id,
            account,
            id === machine
              ? keys.publicKey
                  .export({ type: "spki", format: "der" })
                  .subarray(-32)
              : randomBytes(32),
          ],
        );
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const headers = {
        origin,
        cookie: `remote_session=${token}`,
        "content-type": "application/json",
      };
      async function create(id = machine) {
        const response = await fetch(`${address}/api/machines/${id}/sessions`, {
          method: "POST",
          headers,
          body: JSON.stringify({ source: "desktop" }),
          signal: AbortSignal.timeout(2000),
        });
        assert.equal(response.status, 200);
        return (await response.json()) as { id: string };
      }
      function poll(handled?: string) {
        const nonce = randomUUID(),
          timestamp = Date.now();
        const abort = new AbortController();
        aborters.push(abort);
        const body = {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          signature: sign(
            null,
            Buffer.from(heartbeatMessage(machine, timestamp, nonce)),
            keys.privateKey,
          ).toString("base64"),
        };
        const response = fetch(
          `${address}/api/agent/heartbeat?wait=1${handled ? `&handled=${handled}` : ""}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: abort.signal,
          },
        );
        // Attach a handler immediately so deliberate network aborts cannot leak rejections.
        void response.catch(() => {});
        async function accepted() {
          for (let attempt = 0; attempt < 100; attempt++) {
            if (
              (
                await pool.query(
                  "SELECT 1 FROM heartbeat_nonces WHERE machine_id=$1 AND nonce=$2",
                  [machine, nonce],
                )
              ).rowCount
            )
              return;
            await delay(10);
          }
          assert.fail("signed poll did not commit authentication");
        }
        return { response, accepted, abort, body };
      }
      async function stillWaiting(response: Promise<Response>) {
        await Promise.race([
          response.then(() =>
            assert.fail("idle poll returned before a new request"),
          ),
          delay(50),
        ]);
      }
      const first = poll();
      await first.accepted();
      await stillWaiting(first.response);
      // The single-connection pool remains available while the HTTP poll waits.
      assert.equal((await pool.query("SELECT 1")).rowCount, 1);
      const unrelated = await create(other);
      await stillWaiting(first.response);
      const grant = await create();
      const delivered = await Promise.race([
        first.response,
        delay(2000).then(() => {
          throw new Error("new request did not wake poll");
        }),
      ]);
      assert.equal(delivered.status, 200);
      const body = await delivered.json();
      assert.equal(body.pollAfterMillis, 0);
      assert.equal(body.sessions[0].id, grant.id);
      const replay = await fetch(`${address}/api/agent/heartbeat?wait=1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(first.body),
      });
      assert.equal(replay.status, 409);

      const next = poll(grant.id);
      await next.accepted();
      await stillWaiting(next.response);
      const stop = await fetch(`${address}/api/sessions/${grant.id}/stop`, {
        method: "POST",
        headers,
        body: "{}",
      });
      assert.equal(stop.status, 200);
      const fresh = await create();
      const renewed = await next.response;
      assert.equal((await renewed.json()).sessions[0].id, fresh.id);
      const disconnected = poll(fresh.id);
      await disconnected.accepted();
      await stillWaiting(disconnected.response);
      disconnected.abort.abort();
      await assert.rejects(disconnected.response);
      const revoked = poll(fresh.id);
      await revoked.accepted();
      await stillWaiting(revoked.response);
      const revoke = await fetch(`${address}/api/machines/${machine}/revoke`, {
        method: "POST",
        headers,
        body: "{}",
      });
      assert.equal(revoke.status, 200);
      assert.deepEqual((await (await revoked.response).json()).sessions, []);
      const rejected = poll();
      assert.equal((await rejected.response).status, 401);

      const stopOther = await fetch(
        `${address}/api/sessions/${unrelated.id}/stop`,
        { method: "POST", headers, body: "{}" },
      );
      assert.equal(stopOther.status, 200);
    } finally {
      for (const abort of aborters) abort.abort();
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);
