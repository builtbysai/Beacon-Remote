import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";
import type { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

test(
  "view grants enforce isolation, local consent, single use and immediate revocation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    for (const file of ["001_identity.sql", "002_view_sessions.sql"]) {
      await pool.query(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    }
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
    const stranger = randomUUID();
    const machine = randomUUID();
    const keys = generateKeyPairSync("ed25519");
    const sockets: WebSocket[] = [];
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const browserToken = randomBytes(32).toString("base64url");
    const strangerToken = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${browserToken}` };
    const alien = { origin, cookie: `remote_session=${strangerToken}` };
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
      return response.json().sessions as { id: string; token: string }[];
    };
    let createAddress = 1;
    const create = async (requestHeaders = headers) =>
      app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers: requestHeaders,
        remoteAddress: `198.51.100.${createAddress++}`,
        payload: { source: "synthetic" },
      });
    const connect = async (
      id: string,
      role: "viewer" | "machine",
      requestHeaders: Record<string, string>,
    ) => {
      const socket = await app.injectWS(
        `/api/sessions/${id}/signal?role=${role}`,
        { headers: requestHeaders },
      );
      sockets.push(socket);
      return socket;
    };
    const received = async (socket: WebSocket, send: () => void) => {
      const message = once(socket, "message", {
        signal: AbortSignal.timeout(3000),
      });
      send();
      return JSON.parse((await message)[0].toString());
    };
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
        [digest(browserToken), account, digest(strangerToken), stranger],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Consent fixture',$3,now())",
        [
          machine,
          account,
          keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
        ],
      );
      assert.equal((await create(alien)).statusCode, 404);
      assert.equal(
        (await create({ ...headers, origin: "https://evil.example.test" }))
          .statusCode,
        403,
      );
      const grant = await create();
      assert.equal(grant.statusCode, 200);
      const id = grant.json().id as string;
      assert.equal((await create()).statusCode, 409);
      const pending = await beat();
      assert.equal(pending[0]!.id, id);
      await assert.rejects(connect(id, "viewer", alien));
      await assert.rejects(
        connect(id, "viewer", {
          ...headers,
          origin: "https://evil.example.test",
        }),
      );
      await assert.rejects(
        connect(id, "machine", {
          authorization: `Bearer ${randomBytes(32).toString("base64url")}`,
        }),
      );
      const viewer = await connect(id, "viewer", headers);
      const native = await connect(id, "machine", {
        authorization: `Bearer ${pending[0]!.token}`,
      });
      assert.deepEqual(await beat(), []);
      await assert.rejects(
        connect(id, "machine", {
          authorization: `Bearer ${pending[0]!.token}`,
        }),
      );
      assert.deepEqual(
        await received(viewer, () =>
          native.send(JSON.stringify({ type: "consent", accepted: true })),
        ),
        { type: "consent", accepted: true },
      );
      const lease = await received(native, () =>
        native.send(JSON.stringify({ type: "renew", nonce: "1" })),
      );
      assert.equal(lease.type, "lease");
      assert.equal(lease.nonce, "1");
      assert.equal(lease.maxAgeMs, 3000);
      assert.deepEqual(
        await received(viewer, () =>
          native.send(
            JSON.stringify({ type: "offer", sdp: "bounded-test-offer" }),
          ),
        ),
        { type: "offer", sdp: "bounded-test-offer" },
      );
      // Revocation must reject the very next packet, without waiting for the timer.
      await pool.query("UPDATE machines SET revoked_at=now() WHERE id=$1", [
        machine,
      ]);
      assert.equal(
        (
          await received(viewer, () =>
            native.send(
              JSON.stringify({ type: "offer", sdp: "must-not-forward" }),
            ),
          )
        ).type,
        "ended",
      );
      assert.equal(
        (await pool.query("SELECT status FROM view_sessions WHERE id=$1", [id]))
          .rows[0].status,
        "ended",
      );
      await assert.rejects(
        connect(id, "machine", {
          authorization: `Bearer ${pending[0]!.token}`,
        }),
      );
      await pool.query(
        "UPDATE machines SET revoked_at=NULL,last_seen_at=now() WHERE id=$1",
        [machine],
      );
      const noConsent = await create();
      assert.equal(noConsent.statusCode, 200);
      const secondId = noConsent.json().id as string;
      const secondToken = (await beat())[0]!.token;
      const waitingViewer = await connect(secondId, "viewer", headers);
      const waitingNative = await connect(secondId, "machine", {
        authorization: `Bearer ${secondToken}`,
      });
      assert.equal(
        (
          await received(waitingViewer, () =>
            waitingNative.send(
              JSON.stringify({ type: "offer", sdp: "no-local-consent" }),
            ),
          )
        ).type,
        "ended",
      );
      const logoutGrant = await create();
      assert.equal(logoutGrant.statusCode, 200);
      const logoutId = logoutGrant.json().id as string;
      const logoutToken = (await beat())[0]!.token;
      const logoutViewer = await connect(logoutId, "viewer", headers);
      const logoutNative = await connect(logoutId, "machine", {
        authorization: `Bearer ${logoutToken}`,
      });
      await received(logoutViewer, () =>
        logoutNative.send(JSON.stringify({ type: "consent", accepted: true })),
      );
      const ended = once(logoutViewer, "message", {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/logout",
            headers,
            payload: {},
          })
        ).statusCode,
        200,
      );
      assert.equal(JSON.parse((await ended)[0].toString()).type, "ended");
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            logoutId,
          ])
        ).rows[0].status,
        "ended",
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
