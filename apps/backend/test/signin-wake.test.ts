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
  signinBindingMessage,
  signinHeartbeatMessage,
  signinWakeProofMessage,
} from "../../../packages/protocol/src/index.js";

test(
  "a locked console's password prompt is raised only for its owner's request, once, on that console",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    assert.equal(new URL(url).hostname, "127.0.0.1");
    const admin = new Pool({ connectionString: url });
    const schema = `signin_wake_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    const origin = "https://remote.example.test";
    const config = {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test" as const,
      HOST: "127.0.0.1",
      PORT: 3010,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true" as const,
      SIGNIN_AUTHORITY_ENABLED: "true" as const,
      SIGNIN_MEDIA_ENABLED: "true" as "true" | undefined,
    };
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    const user = generateKeyPairSync("ed25519"),
      endpoint = generateKeyPairSync("ed25519"),
      outsider = generateKeyPairSync("ed25519");
    const raw = (key: typeof user) =>
      key.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const signature = (key: typeof user, message: string) =>
      sign(null, Buffer.from(message), key.privateKey).toString("base64");
    const machine = randomUUID(),
      account = randomUUID(),
      other = randomUUID();
    const browser = randomBytes(32).toString("base64url"),
      stranger = randomBytes(32).toString("base64url");
    const owner = { origin, cookie: `remote_session=${browser}` };
    const base = () => ({
      version: 1 as const,
      machineId: machine,
      timestamp: Date.now(),
      nonce: randomUUID(),
      signature: "",
    });
    const consoleId = 12;
    const beat = (state: "unavailable" | "signed-in") => {
      const b = {
        ...base(),
        instanceId: randomUUID(),
        consoleSessionId: consoleId,
        state,
        workerReady: false,
        workerPublicKey: null,
      };
      b.signature = signature(endpoint, signinHeartbeatMessage(b));
      return b;
    };
    const wakeProof = (console = consoleId, signer = endpoint) => {
      const b = { ...base(), consoleSessionId: console };
      b.signature = signature(signer, signinWakeProofMessage(b));
      return b;
    };
    const post = (
      path: string,
      payload: object,
      headers?: Record<string, string>,
    ) => app!.inject({ method: "POST", url: path, payload, headers });
    const authority = async () =>
      (
        await app!.inject({
          method: "GET",
          url: `/api/machines/${machine}/signin-authority`,
          headers: owner,
        })
      ).json();
    const ask = (headers: Record<string, string>) =>
      post(`/api/machines/${machine}/signin-wake`, {}, headers);
    try {
      await applyMigrations(pool);
      for (const id of [account, other])
        await pool.query(
          "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
          [id, `${id}@example.test`],
        );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Wake fixture',$3)",
        [machine, account, raw(user)],
      );
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
        [machine],
      );
      for (const [token, id] of [
        [browser, account],
        [stranger, other],
      ])
        await pool.query(
          "INSERT INTO browser_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
          [createHash("sha256").update(token!).digest("hex"), id],
        );
      app = await createApp(pool, config);
      const binding = {
        ...base(),
        publicKey: raw(endpoint).toString("base64"),
      };
      binding.signature = signature(user, signinBindingMessage(binding));
      assert.equal(
        (await post("/api/agent/signin-binding", binding)).statusCode,
        200,
      );

      // Locked on the lock-screen picture: reporting, no worker.
      assert.equal(
        (await post("/api/signin/heartbeat", beat("unavailable"))).statusCode,
        200,
      );
      const locked = await authority();
      assert.equal(locked.wakeable, true);
      assert.equal(locked.endpointReady, false);

      // Nothing asked yet: the endpoint hears no.
      assert.deepEqual((await post("/api/signin/wake", wakeProof())).json(), {
        wake: false,
      });
      // Only the owner, from the web origin, can ask.
      assert.equal(
        (await ask({ origin, cookie: `remote_session=${stranger}` }))
          .statusCode,
        404,
      );
      assert.equal(
        (await ask({ cookie: `remote_session=${browser}` })).statusCode,
        403,
      );
      assert.equal((await ask(owner)).statusCode, 200);
      // A forged or replayed proof, or another console, learns nothing and does not consume the request.
      assert.equal(
        (await post("/api/signin/wake", wakeProof(consoleId, outsider)))
          .statusCode,
        401,
      );
      const once = wakeProof();
      const replay = { ...once };
      assert.deepEqual(
        (await post("/api/signin/wake", wakeProof(consoleId + 1))).json(),
        { wake: false },
      );
      assert.deepEqual((await post("/api/signin/wake", once)).json(), {
        wake: true,
      });
      assert.equal((await post("/api/signin/wake", replay)).statusCode, 409);
      // Consumed: one request raises the prompt once.
      assert.deepEqual((await post("/api/signin/wake", wakeProof())).json(), {
        wake: false,
      });
      const audit = await pool.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE machine_id=$1 AND action='signin.wake.requested'",
        [machine],
      );
      assert.equal(audit.rows[0].n, 1);

      // Unlocked: nothing to wake.
      assert.equal(
        (await post("/api/signin/heartbeat", beat("signed-in"))).statusCode,
        200,
      );
      assert.equal((await authority()).wakeable, false);
      assert.equal((await ask(owner)).statusCode, 404);

      // Without trusted control there is no sign-in access, so no waking either.
      assert.equal(
        (await post("/api/signin/heartbeat", beat("unavailable"))).statusCode,
        200,
      );
      await pool.query(
        "UPDATE machine_access SET allow_control=false WHERE machine_id=$1",
        [machine],
      );
      assert.equal((await authority()).wakeable, false);
      assert.equal((await ask(owner)).statusCode, 404);

      // Media off: the routes are closed.
      await app.close();
      app = await createApp(pool, {
        ...config,
        SIGNIN_MEDIA_ENABLED: undefined,
      });
      assert.equal((await ask(owner)).statusCode, 503);
      assert.equal(
        (await post("/api/signin/wake", wakeProof())).statusCode,
        503,
      );
    } finally {
      await app?.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
