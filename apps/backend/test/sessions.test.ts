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
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "view grants enforce isolation, local consent, single use and immediate revocation",
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
      TURN_SECRET: randomBytes(32).toString("hex"),
      TURN_URLS: ["turn:relay.example.test:3478?transport=udp"],
      ICE_TRANSPORT_POLICY: "relay",
      RECONNECT_WINDOW_SECONDS: 10,
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
      return response.json().sessions as {
        id: string;
        token: string;
        iceServers: unknown[];
        iceTransportPolicy: string;
      }[];
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
    const received = async (
      socket: WebSocket,
      send: () => void,
      label = "signal",
    ) => {
      const message = once(socket, "message", {
        signal: AbortSignal.timeout(3000),
      });
      send();
      try {
        return JSON.parse((await message)[0].toString());
      } catch (cause) {
        throw new Error(`Timed out waiting for ${label}`, { cause });
      }
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
      assert.deepEqual(pending[0]!.iceServers, grant.json().iceServers);
      assert.equal(pending[0]!.iceTransportPolicy, "relay");
      assert.equal(grant.json().iceTransportPolicy, "relay");
      assert.equal(pending[0]!.iceServers.length, 2);
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
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM audit_events WHERE account_id=$1 AND machine_id=$2 AND action='desktop.view.accepted'",
            [account, machine],
          )
        ).rowCount,
        1,
      );
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
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM audit_events WHERE account_id=$1 AND machine_id=$2 AND action='desktop.view.accepted'",
            [account, machine],
          )
        ).rowCount,
        1,
      );
      const deniedGrant = await create();
      assert.equal(deniedGrant.statusCode, 200);
      const deniedId = deniedGrant.json().id as string;
      const deniedToken = (await beat())[0]!.token;
      const deniedViewer = await connect(deniedId, "viewer", headers);
      const deniedNative = await connect(deniedId, "machine", {
        authorization: `Bearer ${deniedToken}`,
      });
      assert.deepEqual(
        await received(deniedViewer, () =>
          deniedNative.send(
            JSON.stringify({ type: "consent", accepted: false }),
          ),
        ),
        { type: "consent", accepted: false },
      );
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            deniedId,
          ])
        ).rows[0].status,
        "denied",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM audit_events WHERE account_id=$1 AND machine_id=$2 AND action='desktop.view.denied'",
            [account, machine],
          )
        ).rowCount,
        1,
      );
      // Browser refresh/network loss and helper exit must consume the old grant.
      // Reconnecting a socket cannot revive consent or renew its native lease.
      for (const lostRole of ["viewer", "machine"] as const) {
        const interruptedGrant = await create();
        assert.equal(interruptedGrant.statusCode, 200);
        const interruptedId = interruptedGrant.json().id as string;
        const interruptedToken = (await beat())[0]!.token;
        const interruptedViewer = await connect(
          interruptedId,
          "viewer",
          headers,
        );
        const interruptedNative = await connect(interruptedId, "machine", {
          authorization: `Bearer ${interruptedToken}`,
        });
        await received(interruptedViewer, () =>
          interruptedNative.send(
            JSON.stringify({ type: "consent", accepted: true }),
          ),
        );
        const surviving =
          lostRole === "viewer" ? interruptedNative : interruptedViewer;
        const closed = once(surviving, "close", {
          signal: AbortSignal.timeout(3000),
        });
        (lostRole === "viewer"
          ? interruptedViewer
          : interruptedNative
        ).terminate();
        await closed;
        assert.equal(
          (
            await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
              interruptedId,
            ])
          ).rows[0].status,
          "ended",
        );
        await assert.rejects(connect(interruptedId, "viewer", headers));
        await assert.rejects(
          connect(interruptedId, "machine", {
            authorization: `Bearer ${interruptedToken}`,
          }),
        );
        assert.deepEqual(await beat(), []);
      }
      // A reload may replace only its original browser transport, within the
      // same approval/deadline. A second login on the same account is not it.
      const otherBrowser = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [digest(otherBrowser), account],
      );
      const reloadGrant = await create();
      const reloadId = reloadGrant.json().id as string;
      const reloadToken = (await beat())[0]!.token;
      const reloadViewer = await connect(reloadId, "viewer", headers);
      const reloadNative = await connect(reloadId, "machine", {
        authorization: `Bearer ${reloadToken}`,
      });
      const resume = (resumeHeaders = headers) =>
        app.inject({
          method: "POST",
          url: `/api/sessions/${reloadId}/resume`,
          headers: resumeHeaders,
          payload: {},
        });
      assert.equal((await resume()).statusCode, 403);
      await received(reloadViewer, () =>
        reloadNative.send(
          JSON.stringify({ type: "consent", accepted: true, resumable: true }),
        ),
      );
      const detached = await received(reloadNative, () =>
        reloadViewer.terminate(),
      );
      assert.equal(detached.type, "viewer-detached");
      const recovered = await resume();
      assert.equal(recovered.statusCode, 200);
      assert.equal(
        recovered.json().expiresAtMillis,
        reloadGrant.json().expiresAtMillis,
      );
      assert.equal((await resume(alien)).statusCode, 403);
      assert.equal(
        (await resume({ origin, cookie: `remote_session=${otherBrowser}` }))
          .statusCode,
        403,
      );
      assert.equal(
        (await resume({ ...headers, origin: "https://evil.example.test" }))
          .statusCode,
        403,
      );
      await assert.rejects(
        connect(reloadId, "viewer", {
          origin,
          cookie: `remote_session=${otherBrowser}`,
        }),
      );
      const resumedMessage = once(reloadNative, "message", {
        signal: AbortSignal.timeout(3000),
      });
      const replacementViewer = await connect(reloadId, "viewer", headers);
      assert.equal(
        JSON.parse((await resumedMessage)[0].toString()).type,
        "viewer-resumed",
      );
      assert.deepEqual(
        await received(replacementViewer, () => {
          reloadNative.send(
            JSON.stringify({ type: "offer", sdp: "stale", generation: 0 }),
          );
          reloadNative.send(
            JSON.stringify({ type: "offer", sdp: "fresh", generation: 1 }),
          );
        }),
        { type: "offer", sdp: "fresh", generation: 1 },
      );
      assert.deepEqual(
        await received(replacementViewer, () => {
          reloadNative.send(JSON.stringify({ type: "retry", generation: 0 }));
          reloadNative.send(JSON.stringify({ type: "retry", generation: 1 }));
        }),
        { type: "retry", generation: 1 },
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS total FROM audit_events WHERE machine_id=$1 AND action='desktop.view.accepted' AND occurred_at >= (SELECT created_at FROM view_sessions WHERE id=$2)",
            [machine, reloadId],
          )
        ).rows[0].total,
        1,
      );
      await received(reloadNative, () => replacementViewer.terminate());
      const recoveryEnded = once(reloadNative, "close", {
        signal: AbortSignal.timeout(3000),
      });
      await app.inject({
        method: "POST",
        url: `/api/sessions/${reloadId}/stop`,
        headers,
        payload: {},
      });
      await recoveryEnded;
      assert.equal((await resume()).statusCode, 403);
      await assert.rejects(connect(reloadId, "viewer", headers));

      for (const boundary of [
        "expiry",
        "revoke",
        "recovery-timeout",
      ] as const) {
        const grant = await create();
        const boundaryId = grant.json().id as string;
        const token = (await beat())[0]!.token;
        const viewer = await connect(boundaryId, "viewer", headers);
        const native = await connect(boundaryId, "machine", {
          authorization: `Bearer ${token}`,
        });
        await received(viewer, () =>
          native.send(
            JSON.stringify({
              type: "consent",
              accepted: true,
              resumable: true,
            }),
          ),
        );
        await received(native, () => viewer.terminate());
        const stopped = once(native, "close", {
          signal: AbortSignal.timeout(12000),
        });
        if (boundary === "expiry")
          await pool.query(
            "UPDATE view_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
            [boundaryId],
          );
        if (boundary === "revoke")
          await pool.query("UPDATE machines SET revoked_at=now() WHERE id=$1", [
            machine,
          ]);
        if (boundary !== "recovery-timeout")
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: `/api/sessions/${boundaryId}/resume`,
                headers,
                payload: {},
              })
            ).statusCode,
            403,
          );
        await stopped;
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: `/api/sessions/${boundaryId}/resume`,
              headers,
              payload: {},
            })
          ).statusCode,
          403,
        );
        await assert.rejects(connect(boundaryId, "viewer", headers));
        await pool.query(
          "UPDATE machines SET revoked_at=NULL,last_seen_at=now() WHERE id=$1",
          [machine],
        );
      }

      for (const boundary of ["before-consent", "viewer-role"]) {
        const retryGrant = await create();
        assert.equal(retryGrant.statusCode, 200);
        const retryId = retryGrant.json().id as string;
        const retryToken = (await beat())[0]!.token;
        const retryViewer = await connect(retryId, "viewer", headers);
        const retryNative = await connect(retryId, "machine", {
          authorization: `Bearer ${retryToken}`,
        });
        if (boundary === "viewer-role") {
          await received(retryViewer, () =>
            retryNative.send(
              JSON.stringify({
                type: "consent",
                accepted: true,
                resumable: true,
              }),
            ),
          );
        }
        const destination = retryViewer;
        const sender = boundary === "viewer-role" ? retryViewer : retryNative;
        assert.equal(
          (
            await received(
              destination,
              () =>
                sender.send(JSON.stringify({ type: "retry", generation: 0 })),
              boundary,
            )
          ).type,
          "ended",
        );
        assert.equal(
          (
            await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
              retryId,
            ])
          ).rows[0].status,
          "ended",
        );
      }
      const logoutGrant = await create();
      assert.equal(logoutGrant.statusCode, 200);
      const logoutId = logoutGrant.json().id as string;
      const logoutToken = (await beat())[0]!.token;
      const logoutViewer = await connect(logoutId, "viewer", headers);
      const logoutNative = await connect(logoutId, "machine", {
        authorization: `Bearer ${logoutToken}`,
      });
      await received(logoutViewer, () =>
        logoutNative.send(
          JSON.stringify({ type: "consent", accepted: true, resumable: true }),
        ),
      );
      await received(logoutNative, () => logoutViewer.terminate());
      const ended = once(logoutNative, "close", {
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
      await ended;
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
