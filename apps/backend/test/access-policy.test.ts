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
} from "../../../packages/protocol/src/index.js";

test(
  "only the computer raises its access; lowering it ends the sessions it allowed",
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
      CONTROL_ENABLED: "true",
    });
    await app.ready();
    const account = randomUUID();
    const machine = randomUUID();
    const keys = generateKeyPairSync("ed25519");
    const stranger = generateKeyPairSync("ed25519");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const browserToken = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${browserToken}` };
    const signWith = (key: typeof keys.privateKey, message: string) =>
      sign(null, Buffer.from(message), key).toString("base64");
    const access = (
      mode: "attended" | "trusted",
      allowControl: boolean,
      options: {
        key?: typeof keys.privateKey;
        timestamp?: number;
        nonce?: string;
      } = {},
    ) => {
      const timestamp = options.timestamp ?? Date.now();
      const nonce = options.nonce ?? randomUUID();
      return app.inject({
        method: "POST",
        url: "/api/agent/access",
        payload: {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          mode,
          allowControl,
          signature: signWith(
            options.key ?? keys.privateKey,
            accessMessage(machine, timestamp, nonce, mode, allowControl),
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
        access: { mode: string; allowControl: boolean; version: number };
        sessions: {
          id: string;
          approval: string;
          expiresAtMillis: number;
          approvalExpiresAtMillis: number;
        }[];
      };
    };
    let address = 1;
    const create = (capability: "desktop:view" | "desktop:control") =>
      app.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers,
        remoteAddress: `198.51.100.${address++}`,
        payload: { source: "desktop", capability },
      });
    const statusOf = async (id: string) =>
      (
        (
          await app.inject({ method: "GET", url: "/api/sessions", headers })
        ).json().sessions as { id: string; status: string }[]
      ).find((session) => session.id === id)?.status;
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [digest(browserToken), account],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Policy fixture',$3,now())",
        [
          machine,
          account,
          keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
        ],
      );

      // Default: attended. A session needs the local Allow, and it is not capped at two minutes.
      assert.equal((await beat()).access.mode, "attended");
      const attended = await create("desktop:view");
      assert.equal(attended.statusCode, 200);
      assert.equal(attended.json().expiresAtMillis, 0);
      const pendingAttended = (await beat()).sessions[0]!;
      assert.equal(pendingAttended.approval, "local");
      const cap = (
        await pool.query("SELECT expires_at FROM view_sessions WHERE id=$1", [
          attended.json().id,
        ])
      ).rows[0].expires_at as Date;
      assert.ok(cap.getTime() - Date.now() > 11 * 3_600_000);
      await app.inject({
        method: "POST",
        url: `/api/sessions/${attended.json().id}/stop`,
        headers,
        payload: {},
      });

      // The signed-in browser can lower access but never raise it.
      for (const body of [
        { mode: "trusted" },
        { mode: "trusted", allowControl: true },
        { allowControl: true },
      ])
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: `/api/machines/${machine}/access`,
              headers,
              payload: body,
            })
          ).statusCode,
          400,
        );

      // Only the enrolled key, a fresh timestamp and a new nonce can raise it.
      assert.equal(
        (await access("trusted", false, { key: stranger.privateKey }))
          .statusCode,
        401,
      );
      assert.equal(
        (await access("trusted", false, { timestamp: Date.now() - 120_000 }))
          .statusCode,
        401,
      );
      const nonce = randomUUID();
      assert.equal((await access("trusted", false, { nonce })).statusCode, 200);
      assert.equal((await access("trusted", false, { nonce })).statusCode, 409);
      assert.deepEqual((await beat()).access, {
        mode: "trusted",
        allowControl: false,
        version: 1,
      });

      // Trusted viewing is approved by policy; control is still local until the computer allows it.
      const viewing = await create("desktop:view");
      assert.equal(viewing.statusCode, 200);
      const pending = (await beat()).sessions[0]!;
      assert.equal(pending.approval, "policy");
      assert.equal(pending.expiresAtMillis, 0);
      assert.ok(pending.approvalExpiresAtMillis > Date.now());
      await app.inject({
        method: "POST",
        url: `/api/sessions/${viewing.json().id}/stop`,
        headers,
        payload: {},
      });
      const localControl = await create("desktop:control");
      assert.equal(localControl.statusCode, 200);
      assert.equal((await beat()).sessions[0]!.approval, "local");
      await app.inject({
        method: "POST",
        url: `/api/sessions/${localControl.json().id}/stop`,
        headers,
        payload: {},
      });
      assert.equal((await access("trusted", true)).statusCode, 200);
      const policyControl = await create("desktop:control");
      assert.equal(policyControl.statusCode, 200);
      assert.equal((await beat()).sessions[0]!.approval, "policy");
      await app.inject({
        method: "POST",
        url: `/api/sessions/${policyControl.json().id}/stop`,
        headers,
        payload: {},
      });

      // Lowering from the web takes the authority away from the session that relied on it,
      // and raising it again does not revive that session.
      const relying = await create("desktop:view");
      const relyingId = relying.json().id as string;
      assert.equal(await statusOf(relyingId), "requested");
      const lowered = await app.inject({
        method: "POST",
        url: `/api/machines/${machine}/access`,
        headers,
        payload: { mode: "attended" },
      });
      assert.equal(lowered.statusCode, 200);
      assert.equal(lowered.json().changed, true);
      assert.equal(await statusOf(relyingId), "expired");
      assert.equal((await beat()).sessions.length, 0);
      assert.equal((await beat()).access.mode, "attended");
      assert.equal((await access("trusted", false)).statusCode, 200);
      assert.equal(await statusOf(relyingId), "expired");
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);
