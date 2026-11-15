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
  signinLeaseProofMessage,
  signinPendingProofMessage,
  signinDisableMessage,
} from "../../../packages/protocol/src/index.js";

test(
  "sign-in authority isolates credentials, owner/browser/console leases and fresh policy from ordinary desktop access",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    assert.equal(new URL(url).hostname, "127.0.0.1");
    const admin = new Pool({ connectionString: url });
    const schema = `signin_${randomUUID().replaceAll("-", "")}`;
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
    };
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    const user = generateKeyPairSync("ed25519"),
      endpoint = generateKeyPairSync("ed25519"),
      boot = generateKeyPairSync("ed25519");
    const raw = (key: typeof user) =>
      key.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const signature = (key: typeof user, message: string) =>
      sign(null, Buffer.from(message), key.privateKey).toString("base64");
    const machine = randomUUID(),
      account = randomUUID(),
      other = randomUUID();
    const browser = randomBytes(32).toString("base64url"),
      secondBrowser = randomBytes(32).toString("base64url"),
      stranger = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${browser}` };
    const base = () => ({
      version: 1 as const,
      machineId: machine,
      timestamp: Date.now(),
      nonce: randomUUID(),
      signature: "",
    });
    const bind = (key = endpoint, signer = user) => {
      const b = { ...base(), publicKey: raw(key).toString("base64") };
      b.signature = signature(signer, signinBindingMessage(b));
      return b;
    };
    let instance = randomUUID();
    let consoleId = 1;
    const defaultWorkerKey = raw(generateKeyPairSync("ed25519")).toString(
      "base64",
    );
    const beat = (
      signer = endpoint,
      state: "sign-in" | "signed-in" = "sign-in",
    ) => {
      const b = {
        ...base(),
        instanceId: instance,
        consoleSessionId: consoleId,
        state,
        workerReady: state === "sign-in",
        workerPublicKey: state === "sign-in" ? defaultWorkerKey : null,
      };
      b.signature = signature(signer, signinHeartbeatMessage(b));
      return b;
    };
    const proof = (id: string, signer = endpoint) => {
      const b = {
        ...base(),
        instanceId: instance,
        consoleSessionId: consoleId,
        leaseId: id,
      };
      b.signature = signature(signer, signinLeaseProofMessage(b));
      return b;
    };
    const legacyBeat = () => {
      const { workerPublicKey, ...value } = beat();
      assert.ok(workerPublicKey);
      value.signature = signature(endpoint, signinHeartbeatMessage(value));
      return value;
    };
    const workerBeat = (
      workerPublicKey: string | null,
      state: "sign-in" | "signed-in" = "sign-in",
    ) => {
      const b = { ...beat(endpoint, state), workerPublicKey };
      b.signature = signature(endpoint, signinHeartbeatMessage(b));
      return b;
    };
    const post = (path: string, payload: object, auth?: typeof headers) =>
      app!.inject({ method: "POST", url: path, payload, headers: auth });
    const pending = (signer = endpoint) => {
      const b = {
        ...base(),
        instanceId: instance,
        consoleSessionId: consoleId,
      };
      b.signature = signature(signer, signinPendingProofMessage(b));
      return b;
    };
    const leasePath = `/api/machines/${machine}/signin-leases`;
    const requestLease = () => post(leasePath, {}, headers);
    try {
      await applyMigrations(pool);
      await applyMigrations(pool); // Additive migration must be repeatable on current databases.
      for (const id of [account, other])
        await pool.query(
          "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
          [id, `${id}@example.test`],
        );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Sign-in fixture',$3)",
        [machine, account, raw(user)],
      );
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
        [machine],
      );
      await pool.query(
        "INSERT INTO boot_agents(machine_id,public_key) VALUES ($1,$2)",
        [machine, raw(boot)],
      );
      for (const [token, id] of [
        [browser, account],
        [secondBrowser, account],
        [stranger, other],
      ]) {
        await pool.query(
          "INSERT INTO browser_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
          [createHash("sha256").update(token!).digest("hex"), id],
        );
      }
      app = await createApp(pool, config);
      assert.equal(
        (await post("/api/agent/signin-binding", bind())).statusCode,
        503,
      );
      assert.equal(
        (await post("/api/signin/pending", pending())).statusCode,
        503,
      );
      await app.close();
      app = await createApp(pool, {
        ...config,
        SIGNIN_AUTHORITY_ENABLED: "true",
        SIGNIN_MEDIA_ENABLED: "true",
      });
      assert.equal((await requestLease()).statusCode, 404);
      assert.equal(
        (await post("/api/agent/signin-binding", bind(endpoint, boot)))
          .statusCode,
        401,
      );
      for (const key of [user, boot])
        assert.equal(
          (await post("/api/agent/signin-binding", bind(key))).statusCode,
          400,
        );
      const binding = bind();
      assert.equal(
        (await post("/api/agent/signin-binding", binding)).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/agent/signin-binding", binding)).statusCode,
        409,
      );
      for (const key of [user, boot])
        assert.equal(
          (await post("/api/signin/heartbeat", beat(key))).statusCode,
          401,
        );
      const heartbeat = legacyBeat();
      assert.equal(
        (await post("/api/signin/heartbeat", heartbeat)).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/signin/heartbeat", heartbeat)).statusCode,
        409,
      );
      // The worker generates its own ephemeral identity. Only the machine's
      // attestation binds that public key; stripping/substituting it changes
      // the signed domain, even while legacy presence remains supported.
      const worker = generateKeyPairSync("ed25519");
      const workerKey = raw(worker).toString("base64");
      const replacementKey = raw(generateKeyPairSync("ed25519")).toString(
        "base64",
      );
      const attested = workerBeat(workerKey);
      assert.equal(
        (
          await post("/api/signin/heartbeat", {
            ...attested,
            workerPublicKey: replacementKey,
          })
        ).statusCode,
        401,
      );
      const { workerPublicKey: omittedKey, ...stripped } = attested;
      assert.equal(omittedKey, workerKey);
      assert.equal(
        (await post("/api/signin/heartbeat", stripped)).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/signin/heartbeat", workerBeat(null))).statusCode,
        400,
      );
      for (const key of [user, boot, endpoint])
        assert.equal(
          (
            await post(
              "/api/signin/heartbeat",
              workerBeat(raw(key).toString("base64")),
            )
          ).statusCode,
          409,
        );
      assert.equal(
        (await post("/api/signin/heartbeat", attested)).statusCode,
        200,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT encode(worker_public_key,'base64') AS key FROM signin_endpoints WHERE machine_id=$1",
            [machine],
          )
        ).rows[0].key,
        workerKey,
      );
      assert.equal(
        (await post("/api/agent/signin-binding", bind(worker))).statusCode,
        400,
      );
      // Authorization setup alone cannot open media, even with a ready worker.
      await app.close();
      app = await createApp(pool, {
        ...config,
        SIGNIN_AUTHORITY_ENABLED: "true",
      });
      const prepared = await post(
        "/api/signin/heartbeat",
        workerBeat(workerKey),
      );
      assert.equal(prepared.statusCode, 200);
      assert.equal(prepared.json().mediaEnabled, false);
      assert.equal((await requestLease()).statusCode, 503);
      const metadata = () =>
        app!.inject({
          method: "GET",
          url: `/api/machines/${machine}/signin-authority`,
          headers,
        });
      assert.equal((await metadata()).json().connectable, false);
      assert.equal(
        (await post("/api/signin/pending", pending())).statusCode,
        503,
      );
      await app.close();
      app = await createApp(pool, {
        ...config,
        SIGNIN_AUTHORITY_ENABLED: "true",
        SIGNIN_MEDIA_ENABLED: "true",
      });
      assert.equal(
        (await post("/api/signin/heartbeat", workerBeat(workerKey))).json()
          .mediaEnabled,
        true,
      );
      assert.equal((await metadata()).json().connectable, true);
      await pool.query(
        "UPDATE signin_endpoints SET last_seen_at=now()-interval '16 seconds' WHERE machine_id=$1",
        [machine],
      );
      assert.equal(
        (await metadata()).json().connectable,
        false,
        "stale signed presence cannot advertise a connectable worker",
      );
      await post("/api/signin/heartbeat", workerBeat(workerKey));
      await pool.query(
        "UPDATE machine_access SET allow_control=false WHERE machine_id=$1",
        [machine],
      );
      assert.equal(
        (await metadata()).json().connectable,
        false,
        "readiness does not bypass current owner policy",
      );
      await pool.query(
        "UPDATE machine_access SET allow_control=true WHERE machine_id=$1",
        [machine],
      );
      const workerLease = (await requestLease()).json();
      assert.ok(workerLease.id);
      assert.equal(
        (await post("/api/signin/heartbeat", workerBeat(workerKey))).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/signin/authorize", proof(workerLease.id))).statusCode,
        200,
      );
      const replaced = workerBeat(replacementKey);
      assert.equal(
        (await post("/api/signin/heartbeat", replaced)).statusCode,
        409,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT worker_ready FROM signin_endpoints WHERE machine_id=$1",
            [machine],
          )
        ).rows[0].worker_ready,
        false,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM heartbeat_nonces WHERE machine_id=$1 AND nonce=$2",
            [machine, replaced.nonce],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (await post("/api/signin/authorize", proof(workerLease.id))).statusCode,
        403,
      );
      instance = randomUUID();
      assert.equal(
        (await post("/api/signin/heartbeat", workerBeat(replacementKey)))
          .statusCode,
        200,
      );
      const newWorkerLease = (await requestLease()).json();
      assert.ok(newWorkerLease.id);
      const downgraded = legacyBeat();
      assert.equal(
        (await post("/api/signin/heartbeat", downgraded)).statusCode,
        409,
      );
      assert.equal(
        (await post("/api/signin/authorize", proof(newWorkerLease.id)))
          .statusCode,
        403,
      );
      assert.equal(
        (await post("/api/signin/heartbeat", workerBeat(null, "signed-in")))
          .statusCode,
        200,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT worker_public_key FROM signin_endpoints WHERE machine_id=$1",
            [machine],
          )
        ).rows[0].worker_public_key,
        null,
      );
      assert.equal(
        (await post("/api/signin/heartbeat", beat())).statusCode,
        200,
      );
      assert.equal(
        (
          await pool.query("SELECT last_seen_at FROM machines WHERE id=$1", [
            machine,
          ])
        ).rows[0].last_seen_at,
        null,
      );
      assert.equal(
        (
          await post(
            leasePath,
            {},
            { origin, cookie: `remote_session=${stranger}` },
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (await post(leasePath, { files: true }, headers)).statusCode,
        400,
      );
      assert.equal(
        (
          await post(
            leasePath,
            {},
            { ...headers, origin: "https://attacker.example" },
          )
        ).statusCode,
        403,
      );
      assert.deepEqual((await post("/api/signin/pending", pending())).json(), {
        leaseId: null,
      });
      const lease = (await requestLease()).json();
      assert.equal(lease.scope, "windows:sign-in");
      assert.equal(lease.connectable, true);
      for (const signer of [user, boot])
        assert.equal(
          (await post("/api/signin/pending", pending(signer))).statusCode,
          401,
        );
      const discovery = pending();
      const found = await post("/api/signin/pending", discovery);
      assert.equal(found.statusCode, 200);
      assert.deepEqual(found.json(), { leaseId: lease.id });
      assert.equal(found.headers["cache-control"], "no-store");
      assert.equal(
        (await post("/api/signin/pending", discovery)).statusCode,
        409,
      );
      assert.equal(
        (await post("/api/signin/authorize", discovery)).statusCode,
        400,
      );
      const wrongDomain = pending();
      wrongDomain.signature = signature(
        endpoint,
        signinHeartbeatMessage({
          ...wrongDomain,
          state: "sign-in",
          workerReady: true,
        }),
      );
      assert.equal(
        (await post("/api/signin/pending", wrongDomain)).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/signin/pending", { ...pending(), files: true }))
          .statusCode,
        400,
      );
      const staleDiscovery = pending();
      staleDiscovery.timestamp -= 31_000;
      staleDiscovery.signature = signature(
        endpoint,
        signinPendingProofMessage(staleDiscovery),
      );
      assert.equal(
        (await post("/api/signin/pending", staleDiscovery)).statusCode,
        401,
      );
      for (const permission of [
        "files",
        "clipboard",
        "audio",
        "recording",
        "automation",
      ])
        assert.equal(lease[permission], false);
      assert.ok(lease.expiresAtMillis <= Date.now() + 15_000);
      assert.equal((await requestLease()).statusCode, 409);
      assert.equal(
        (
          await post(
            `/api/signin/leases/${lease.id}/renew`,
            {},
            { origin, cookie: `remote_session=${secondBrowser}` },
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (await post(`/api/signin/leases/${lease.id}/renew`, {}, headers))
          .statusCode,
        200,
      );
      const authorization = proof(lease.id);
      assert.equal(
        (await post("/api/signin/authorize", authorization)).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/signin/authorize", authorization)).statusCode,
        409,
      );
      assert.equal(
        (await post("/api/signin/authorize", proof(lease.id, boot))).statusCode,
        401,
      );
      // Cross-console claims cannot use a valid lease, even with the right machine key.
      consoleId = 2;
      const unmatchedDiscovery = pending();
      assert.deepEqual(
        (await post("/api/signin/pending", unmatchedDiscovery)).json(),
        { leaseId: null },
      );
      assert.equal(
        (await post("/api/signin/pending", unmatchedDiscovery)).statusCode,
        409,
      );
      assert.equal(
        (await post("/api/signin/authorize", proof(lease.id))).statusCode,
        403,
      );
      await post("/api/signin/heartbeat", beat());
      assert.equal(
        (await post(`/api/signin/leases/${lease.id}/renew`, {}, headers))
          .statusCode,
        404,
      );
      const next = (await requestLease()).json();
      instance = randomUUID();
      await post("/api/signin/heartbeat", beat());
      assert.equal(
        (await post("/api/signin/authorize", proof(next.id))).statusCode,
        403,
      );
      const current = (await requestLease()).json();
      // Successful Windows sign-in invalidates the machine scope, rather than
      // carrying SYSTEM authority over to the user's ordinary desktop.
      await post("/api/signin/heartbeat", beat(endpoint, "signed-in"));
      assert.deepEqual((await post("/api/signin/pending", pending())).json(), {
        leaseId: null,
      });
      assert.equal(
        (await post("/api/signin/authorize", proof(current.id))).statusCode,
        403,
      );
      await post("/api/signin/heartbeat", beat());
      const policyLease = (await requestLease()).json();
      await pool.query(
        "UPDATE machine_access SET version=version+1 WHERE machine_id=$1",
        [machine],
      );
      assert.deepEqual((await post("/api/signin/pending", pending())).json(), {
        leaseId: null,
      });
      assert.equal(
        (await post("/api/signin/authorize", proof(policyLease.id))).statusCode,
        403,
      );
      await post(`/api/signin/leases/${policyLease.id}/stop`, {}, headers);
      const expired = (await requestLease()).json();
      await pool.query(
        "UPDATE signin_leases SET expires_at=now()-interval '1 second' WHERE id=$1",
        [expired.id],
      );
      assert.equal(
        (await post(`/api/signin/leases/${expired.id}/renew`, {}, headers))
          .statusCode,
        404,
      );
      const locallyStopped = (await requestLease()).json();
      const disable = (signer = endpoint) => {
        const value = base();
        value.signature = signature(signer, signinDisableMessage(value));
        return value;
      };
      for (const signer of [user, boot])
        assert.equal(
          (await post("/api/signin/disable", disable(signer))).statusCode,
          401,
        );
      const staleDisable = { ...base(), timestamp: Date.now() - 31_000 };
      staleDisable.signature = signature(
        endpoint,
        signinDisableMessage(staleDisable),
      );
      assert.equal(
        (await post("/api/signin/disable", staleDisable)).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/signin/disable", { ...disable(), enabled: true }))
          .statusCode,
        400,
      );
      const localDisable = disable();
      assert.equal(
        (await post("/api/signin/disable", localDisable)).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/signin/disable", localDisable)).statusCode,
        409,
      );
      assert.equal(
        (await post("/api/signin/authorize", proof(locallyStopped.id)))
          .statusCode,
        401,
      );
      assert.equal(
        (await post("/api/signin/heartbeat", beat())).statusCode,
        401,
      );
      assert.equal((await requestLease()).statusCode, 404);
      assert.equal(
        (await post("/api/agent/signin-binding", bind())).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/signin/heartbeat", beat())).statusCode,
        200,
      );
      const logout = (await requestLease()).json();
      await pool.query("DELETE FROM browser_sessions WHERE token_hash=$1", [
        createHash("sha256").update(browser).digest("hex"),
      ]);
      assert.equal(
        (await post("/api/signin/authorize", proof(logout.id))).statusCode,
        403,
      );
      const remainingHeaders = {
        origin,
        cookie: `remote_session=${secondBrowser}`,
      };
      assert.equal(
        (
          await post(
            `/api/machines/${machine}/signin-authority/disable`,
            {},
            remainingHeaders,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/signin/heartbeat", beat())).statusCode,
        401,
      );
      assert.equal(
        (await post(leasePath, {}, remainingHeaders)).statusCode,
        404,
      );
      // Lower-only operations remain available even when rollout is disabled.
      await app.close();
      app = await createApp(pool, config);
      assert.equal(
        (await post("/api/signin/disable", disable())).statusCode,
        200,
      );
      const unbind = { ...base(), publicKey: null };
      unbind.signature = signature(user, signinBindingMessage(unbind));
      assert.equal(
        (await post("/api/agent/signin-binding", unbind)).statusCode,
        200,
      );
      await app.close();
      app = await createApp(pool, {
        ...config,
        SIGNIN_AUTHORITY_ENABLED: "true",
      });
      // Binding is atomic with its audit; unavailable audit storage cannot enable access.
      await pool.query(
        `CREATE FUNCTION reject_signin_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture unavailable'; END $$`,
      );
      await pool.query(
        "CREATE TRIGGER reject_signin_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_signin_audit()",
      );
      assert.equal(
        (await post("/api/agent/signin-binding", bind())).statusCode,
        500,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT enabled FROM signin_endpoints WHERE machine_id=$1",
            [machine],
          )
        ).rows[0].enabled,
        false,
      );
    } finally {
      await app?.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
