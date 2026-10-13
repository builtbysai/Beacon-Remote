import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";
import type { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

test(
  "the same browser replaces a viewer whose connection died; another login cannot",
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
      PORT: 3010,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const account = randomUUID();
    const machine = randomUUID();
    const keys = generateKeyPairSync("ed25519");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const first = randomBytes(32).toString("base64url");
    const second = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${first}` };
    const sockets: WebSocket[] = [];
    const connect = async (
      id: string,
      query: string,
      h: Record<string, string>,
    ) => {
      const socket = await app.injectWS(
        `/api/sessions/${id}/signal?role=${query}`,
        {
          headers: h,
        },
      );
      sockets.push(socket);
      return socket;
    };
    const next = async (socket: WebSocket) =>
      JSON.parse(
        (
          await once(socket, "message", { signal: AbortSignal.timeout(3000) })
        )[0].toString(),
      );
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour'),($3,$2,now()+interval '1 hour')",
        [digest(first), account, digest(second)],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Reconnect fixture',$3,now())",
        [
          machine,
          account,
          keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
        ],
      );
      const created = await app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers,
        payload: { source: "synthetic" },
      });
      assert.equal(created.statusCode, 200);
      assert.equal(created.json().reconnectSeconds, 120);
      const id = created.json().id as string;
      const timestamp = Date.now();
      const nonce = randomUUID();
      const beat = await app.inject({
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
      const grant = beat.json().sessions[0] as {
        token: string;
        reconnectSeconds: number;
      };
      assert.equal(grant.reconnectSeconds, 120);
      const viewer = await connect(id, "viewer", headers);
      const native = await connect(id, "machine", {
        authorization: `Bearer ${grant.token}`,
      });
      const consent = next(viewer);
      native.send(
        JSON.stringify({ type: "consent", accepted: true, resumable: true }),
      );
      assert.equal((await consent).accepted, true);

      // The first viewer never closes (a half-open connection). A different login of the same
      // account is refused; the same browser takes over and the machine is told in order.
      await assert.rejects(
        connect(id, "viewer", { origin, cookie: `remote_session=${second}` }),
      );
      const oldClosed = once(viewer, "close", {
        signal: AbortSignal.timeout(3000),
      });
      const told: { type: string; generation?: number }[] = [];
      native.on("message", (data) => told.push(JSON.parse(data.toString())));
      const replacement = await connect(id, "viewer", headers);
      for (let waited = 0; told.length < 2 && waited < 3000; waited += 20)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(told, [
        { type: "viewer-detached" },
        { type: "viewer-resumed", generation: 1 },
      ]);
      await oldClosed;
      assert.equal(replacement.readyState, 1);
      assert.equal(
        (await pool.query("SELECT status FROM view_sessions WHERE id=$1", [id]))
          .rows[0].status,
        "active",
      );
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);
