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
  bootBindingMessage,
  bootHeartbeatMessage,
  heartbeatMessage,
  SUPPORT_CODE_ALPHABET,
} from "../../../packages/protocol/src/index.js";

test(
  "boot credentials are bound by the endpoint, replay-safe, revocable, and never confer interactive presence or grants",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const app = await createApp(pool, {
      DATABASE_URL: url,
      WEB_ORIGIN: "https://remote.example.test",
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3010,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true",
    });
    const account = randomUUID(),
      machine = randomUUID(),
      token = randomBytes(32).toString("base64url");
    const owner = generateKeyPairSync("ed25519"),
      boot = generateKeyPairSync("ed25519"),
      replacement = generateKeyPairSync("ed25519");
    const raw = (key: typeof owner) =>
      key.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const signed = (key: typeof owner, message: string) =>
      sign(null, Buffer.from(message), key.privateKey).toString("base64");
    const headers = {
      origin: "https://remote.example.test",
      cookie: `remote_session=${token}`,
    };
    const binding = (key: typeof owner, publicKey: string | null) => {
      const timestamp = Date.now(),
        nonce = randomUUID();
      return {
        version: 1,
        machineId: machine,
        timestamp,
        nonce,
        publicKey,
        signature: signed(
          key,
          bootBindingMessage(machine, timestamp, nonce, publicKey),
        ),
      };
    };
    const beat = (key: typeof owner, state = "signed-out") => {
      const timestamp = Date.now(),
        nonce = randomUUID();
      return {
        version: 1,
        machineId: machine,
        timestamp,
        nonce,
        state,
        signature: signed(
          key,
          bootHeartbeatMessage(machine, timestamp, nonce, state),
        ),
      };
    };
    const post = (path: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: path, payload });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `boot-${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'boot fixture',$3)",
        [machine, account, raw(owner)],
      );
      await pool.query(
        "INSERT INTO browser_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), account],
      );
      assert.equal(
        (
          await post(
            "/api/agent/boot-binding",
            binding(boot, raw(boot).toString("base64")),
          )
        ).statusCode,
        401,
      );
      const enrollment = binding(owner, raw(boot).toString("base64"));
      assert.equal(
        (await post("/api/agent/boot-binding", enrollment)).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/agent/boot-binding", enrollment)).statusCode,
        409,
      );
      const presence = beat(boot);
      assert.deepEqual((await post("/api/boot/heartbeat", presence)).json(), {
        ok: true,
      });
      assert.equal(
        (await post("/api/boot/heartbeat", presence)).statusCode,
        409,
      );
      assert.equal(
        (await post("/api/boot/heartbeat", { ...beat(boot), state: "locked" }))
          .statusCode,
        401,
        "the signed state cannot be changed",
      );
      const stale = beat(boot);
      stale.timestamp -= 60000;
      assert.equal((await post("/api/boot/heartbeat", stale)).statusCode, 401);
      const inventory = (
        await app.inject({ method: "GET", url: "/api/machines", headers })
      ).json().machines[0];
      assert.equal(inventory.bootState, "signed-out");
      assert.equal(inventory.online, false);
      assert.equal(inventory.lastSeenAt, null);
      const timestamp = Date.now(),
        nonce = randomUUID();
      assert.equal(
        (
          await post("/api/agent/heartbeat", {
            version: 1,
            machineId: machine,
            timestamp,
            nonce,
            signature: signed(
              boot,
              heartbeatMessage(machine, timestamp, nonce),
            ),
          })
        ).statusCode,
        401,
        "boot identity cannot get grants",
      );
      assert.equal(
        (
          await post(
            "/api/agent/boot-binding",
            binding(owner, raw(replacement).toString("base64")),
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/boot/heartbeat", beat(boot))).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/boot/heartbeat", beat(replacement, "locked")))
          .statusCode,
        200,
      );
      assert.equal(
        (await post("/api/agent/boot-binding", binding(owner, null)))
          .statusCode,
        200,
      );
      assert.equal(
        (await post("/api/boot/heartbeat", beat(replacement))).statusCode,
        401,
      );
      assert.equal(
        (
          await post(
            "/api/agent/boot-binding",
            binding(owner, raw(boot).toString("base64")),
          )
        ).statusCode,
        200,
      );
      await pool.query("UPDATE machines SET revoked_at=now() WHERE id=$1", [
        machine,
      ]);
      assert.equal(
        (await post("/api/boot/heartbeat", beat(boot))).statusCode,
        410,
      );
      assert.equal(
        (
          await post(
            "/api/agent/boot-binding",
            binding(owner, raw(boot).toString("base64")),
          )
        ).statusCode,
        401,
      );
    } finally {
      await app.close();
      await pool.query("DELETE FROM audit_events WHERE account_id=$1", [
        account,
      ]);
      await pool.query("DELETE FROM accounts WHERE id=$1", [account]);
      await pool.end();
    }
  },
);

test(
  "boot lock state gates owner, remembered helper and support-code admission consistently with inventory",
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
    const owner = randomUUID(),
      helper = randomUUID(),
      machine = randomUUID(),
      relationship = randomUUID();
    const boot = generateKeyPairSync("ed25519");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const ownerToken = randomBytes(32).toString("base64url"),
      helperToken = randomBytes(32).toString("base64url");
    const headers = (token: string) => ({
      origin,
      cookie: `remote_session=${token}`,
    });
    let address = 1;
    const report = async (state: string) => {
      const timestamp = Date.now(),
        nonce = randomUUID();
      const response = await app.inject({
        method: "POST",
        url: "/api/boot/heartbeat",
        payload: {
          version: 1,
          machineId: machine,
          timestamp,
          nonce,
          state,
          signature: sign(
            null,
            Buffer.from(bootHeartbeatMessage(machine, timestamp, nonce, state)),
            boot.privateKey,
          ).toString("base64"),
        },
      });
      assert.equal(response.statusCode, 200);
    };
    const connections = async (online: boolean) => {
      const inventory = (
        await app.inject({
          method: "GET",
          url: "/api/machines",
          headers: headers(ownerToken),
        })
      ).json().machines[0];
      const shared = (
        await app.inject({
          method: "GET",
          url: "/api/shared",
          headers: headers(helperToken),
        })
      ).json().shared[0];
      assert.equal(inventory.online, online);
      assert.equal(shared.online, online);
      const code = Array.from(
        randomBytes(8),
        (byte) => SUPPORT_CODE_ALPHABET[byte % SUPPORT_CODE_ALPHABET.length],
      ).join("");
      await pool.query(
        "INSERT INTO support_invitations(code_hash,machine_id,capability,expires_at) VALUES ($1,$2,'desktop:view',now()+interval '5 minutes')",
        [digest(code), machine],
      );
      for (const [path, token, payload] of [
        [
          `/api/machines/${machine}/sessions`,
          ownerToken,
          { source: "desktop", capability: "desktop:control" },
        ],
        [
          `/api/relationships/${relationship}/sessions`,
          helperToken,
          { capability: "desktop:control" },
        ],
        ["/api/support/claim", helperToken, { code }],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url: path,
          headers: headers(token),
          remoteAddress: `198.51.100.${address++}`,
          payload,
        });
        assert.equal(
          response.statusCode,
          online ? 200 : 404,
          `${path}: ${response.body}`,
        );
        if (online) {
          // End each fixture request so the next path exercises admission rather than the busy check.
          await pool.query(
            "UPDATE view_sessions SET status='ended' WHERE id=$1",
            [response.json().id],
          );
        }
      }
      assert.equal(
        (
          await pool.query(
            "SELECT claimed_at FROM support_invitations WHERE code_hash=$1",
            [digest(code)],
          )
        ).rows[0].claimed_at !== null,
        online,
        "unavailable computers must not consume support codes",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM view_sessions WHERE machine_id=$1 AND status='requested'",
            [machine],
          )
        ).rowCount,
        0,
      );
    };
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture'),($3,$4,'fixture')",
        [owner, `${owner}@example.test`, helper, `${helper}@example.test`],
      );
      for (const [account, token] of [
        [owner, ownerToken],
        [helper, helperToken],
      ] as const) {
        await pool.query(
          "INSERT INTO browser_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
          [digest(token), account],
        );
      }
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Readiness fixture',$3,now())",
        [machine, owner, randomBytes(32)],
      );
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control,helpers_unattended) VALUES ($1,'trusted',true,'control')",
        [machine],
      );
      await pool.query(
        "INSERT INTO support_relationships(id,machine_id,helper_account_id,capability,expires_at) VALUES ($1,$2,$3,'desktop:control',now()+interval '1 hour')",
        [relationship, machine, helper],
      );
      await pool.query(
        "INSERT INTO boot_agents(machine_id,public_key) VALUES ($1,$2)",
        [
          machine,
          boot.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
        ],
      );
      await report("locked");
      await connections(false);
      await report("signed-out");
      await connections(false);
      await report("starting");
      await connections(true); // Unlocked; the existing desktop heartbeat is still required.
      await report("locked");
      await pool.query(
        "UPDATE boot_agents SET last_seen_at=now()-interval '1 minute' WHERE machine_id=$1",
        [machine],
      );
      await connections(true); // An expired boot report cannot indefinitely override the host.
      await report("starting");
      await pool.query(
        "UPDATE machines SET last_seen_at=now()-interval '1 minute' WHERE id=$1",
        [machine],
      );
      await connections(false); // Boot presence never substitutes for an interactive host.
      await pool.query("UPDATE machines SET last_seen_at=now() WHERE id=$1", [
        machine,
      ]);
      await pool.query("DELETE FROM boot_agents WHERE machine_id=$1", [
        machine,
      ]);
      await connections(true); // Existing endpoints without the optional service still work.
    } finally {
      await app.close();
      await pool.query(
        "DELETE FROM audit_events WHERE account_id=ANY($1::uuid[])",
        [[owner, helper]],
      );
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [
        [owner, helper],
      ]);
      await pool.end();
    }
  },
);
