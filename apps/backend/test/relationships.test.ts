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
  helpersMessage,
} from "../../../packages/protocol/src/index.js";

test(
  "a remembered helper is scoped, still approved locally, and ends the moment it is revoked",
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
      PORT: 3013,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true",
    });
    await app.ready();
    const owner = randomUUID();
    const helper = randomUUID();
    const other = randomUUID();
    const machine = randomUUID();
    const keys = generateKeyPairSync("ed25519");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const tokens = {
      owner: randomBytes(32).toString("base64url"),
      helper: randomBytes(32).toString("base64url"),
      other: randomBytes(32).toString("base64url"),
    };
    const as = (who: keyof typeof tokens) => ({
      origin,
      cookie: `remote_session=${tokens[who]}`,
    });
    let address = 1;
    const ip = () => `198.51.100.${address++}`;
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
      return response.json() as {
        sessions: { id: string; approval: string; controller: string }[];
      };
    };
    const statusOf = async (id: string) =>
      (await pool.query("SELECT status FROM view_sessions WHERE id=$1", [id]))
        .rows[0].status as string;
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'x'),($3,$4,'x'),($5,$6,'x')",
        [
          owner,
          `${owner}@example.test`,
          helper,
          `${helper}@example.test`,
          other,
          `${other}@example.test`,
        ],
      );
      for (const [who, id] of [
        ["owner", owner],
        ["helper", helper],
        ["other", other],
      ] as const)
        await pool.query(
          "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
          [digest(tokens[who]), id],
        );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Relationship fixture',$3,now())",
        [
          machine,
          owner,
          keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
        ],
      );
      // Trusted access on the computer must not leak to a helper.
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
        [machine],
      );
      const grant = (
        who: keyof typeof tokens,
        payload: object,
        remoteAddress = ip(),
      ) =>
        app.inject({
          method: "POST",
          url: `/api/machines/${machine}/relationships`,
          headers: as(who),
          remoteAddress,
          payload,
        });
      const share = {
        email: `${helper}@example.test`,
        capability: "desktop:view",
        days: 7,
      };

      // Only the owner can share, and only with another existing account.
      assert.equal((await grant("other", share)).statusCode, 404);
      assert.equal(
        (await grant("owner", { ...share, email: `${owner}@example.test` }))
          .statusCode,
        404,
      );
      assert.equal(
        (await grant("owner", { ...share, email: "nobody@example.test" }))
          .statusCode,
        404,
      );
      assert.equal(
        (await grant("owner", { ...share, days: 400 })).statusCode,
        400,
      );
      const granted = await grant("owner", share);
      assert.equal(granted.statusCode, 200);
      const relationship = granted.json().id as string;

      const listed = await app.inject({
        method: "GET",
        url: `/api/machines/${machine}/relationships`,
        headers: as("owner"),
      });
      assert.equal(listed.json().relationships.length, 1);
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: `/api/machines/${machine}/relationships`,
            headers: as("other"),
          })
        ).json().relationships.length,
        0,
      );
      const shared = (
        await app.inject({
          method: "GET",
          url: "/api/shared",
          headers: as("helper"),
        })
      ).json().shared;
      assert.equal(shared.length, 1);
      assert.equal(shared[0].online, true);

      // The helper may view but not control, and a stranger gets nothing.
      const request = (who: keyof typeof tokens, payload: object = {}) =>
        app.inject({
          method: "POST",
          url: `/api/relationships/${relationship}/sessions`,
          headers: as(who),
          remoteAddress: ip(),
          payload,
        });
      assert.equal((await request("other")).statusCode, 404);
      assert.equal(
        (await request("helper", { capability: "desktop:control" })).statusCode,
        403,
      );
      const session = await request("helper");
      assert.equal(session.statusCode, 200);
      assert.equal(session.json().approval, "local");
      const pending = (await beat()).sessions[0]!;
      assert.equal(pending.id, session.json().id);
      assert.equal(pending.approval, "local");
      assert.equal(pending.controller, `${helper}@example.test`);
      await pool.query("UPDATE view_sessions SET status='active' WHERE id=$1", [
        pending.id,
      ]);

      // Revoking ends the live session at once, and the helper can no longer ask.
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/relationships/${relationship}/revoke`,
            headers: as("other"),
            payload: {},
          })
        ).statusCode,
        404,
      );
      const revoked = await app.inject({
        method: "POST",
        url: `/api/relationships/${relationship}/revoke`,
        headers: as("owner"),
        payload: {},
      });
      assert.equal(revoked.statusCode, 200);
      assert.equal(revoked.json().ended, 1);
      assert.notEqual(await statusOf(pending.id), "active");
      assert.equal((await request("helper")).statusCode, 404);
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/api/shared",
            headers: as("helper"),
          })
        ).json().shared.length,
        0,
      );

      // The computer can let remembered helpers skip the Allow, and only the computer can.
      const setHelpers = (
        level: "off" | "view" | "control",
        key = keys.privateKey,
      ) => {
        const timestamp = Date.now();
        const nonce = randomUUID();
        return app.inject({
          method: "POST",
          url: "/api/agent/helpers",
          payload: {
            version: 1,
            machineId: machine,
            timestamp,
            nonce,
            level,
            signature: sign(
              null,
              Buffer.from(helpersMessage(machine, timestamp, nonce, level)),
              key,
            ).toString("base64"),
          },
        });
      };
      assert.equal(
        (await setHelpers("view", generateKeyPairSync("ed25519").privateKey))
          .statusCode,
        401,
      );
      const viewOnly = (await grant("owner", share)).json().id as string;
      const asHelper = (id: string, capability = "desktop:view") =>
        app.inject({
          method: "POST",
          url: `/api/relationships/${id}/sessions`,
          headers: as("helper"),
          remoteAddress: ip(),
          payload: { capability },
        });
      // Before the computer agrees, the Allow is still required.
      const asked = await asHelper(viewOnly);
      assert.equal(asked.json().approval, "local");
      await pool.query(
        "UPDATE view_sessions SET status='ended' WHERE machine_id=$1",
        [machine],
      );
      assert.equal((await setHelpers("view")).statusCode, 200);
      const skipped = await asHelper(viewOnly);
      assert.equal(skipped.statusCode, 200);
      assert.equal(skipped.json().approval, "policy");
      const policySession = (await beat()).sessions.find(
        (entry) => entry.id === skipped.json().id,
      )!;
      assert.equal(policySession.approval, "policy");
      // Lowering it from the web ends the helper's session at once.
      await pool.query("UPDATE view_sessions SET status='active' WHERE id=$1", [
        policySession.id,
      ]);
      const lowered = await app.inject({
        method: "POST",
        url: `/api/machines/${machine}/access`,
        headers: as("owner"),
        payload: { helpers: "off" },
      });
      assert.equal(lowered.json().changed, true);
      const after = (
        await app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: as("helper"),
        })
      ).json().sessions as { id: string; status: string }[];
      assert.equal(
        after.find((entry) => entry.id === policySession.id)?.status,
        "expired",
      );
      // A view level never covers control, and a one-time code is never skipped.
      assert.equal((await setHelpers("view")).statusCode, 200);

      // An expired relationship is dead too, and a session that relied on it stops being live.
      const again = await grant("owner", {
        ...share,
        capability: "desktop:control",
      });
      const second = again.json().id as string;
      await pool.query(
        "UPDATE support_relationships SET expires_at=now()-interval '1 second' WHERE id=$1",
        [second],
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/relationships/${second}/sessions`,
            headers: as("helper"),
            remoteAddress: ip(),
            payload: {},
          })
        ).statusCode,
        404,
      );
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id IN ($1,$2,$3)", [
        owner,
        helper,
        other,
      ]);
      await pool.end();
    }
  },
);
