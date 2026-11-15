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
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";
import {
  heartbeatMessage,
  signinBindingMessage,
  signinHeartbeatMessage,
  signinHandoffMessage,
  signinDisableMessage,
} from "../../../packages/protocol/src/index.js";

test(
  "handoff accepts only retired endpoint proof and original browser, consumes fresh policy once, and Stop cancels late desktop grants",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.equal(new URL(url).hostname, "127.0.0.1");
    assert.match(new URL(url).pathname, /_test$/);
    const admin = new Pool({ connectionString: url });
    const schema = `handoff_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      application_name: schema,
    });
    const account = randomUUID(),
      machine = randomUUID(),
      origin = "https://remote.example.test";
    const user = generateKeyPairSync("ed25519"),
      endpoint = generateKeyPairSync("ed25519");
    const raw = (keys: typeof user) =>
      keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const signature = (keys: typeof user, text: string) =>
      sign(null, Buffer.from(text), keys.privateKey).toString("base64");
    const browsers = [
      randomBytes(32).toString("base64url"),
      randomBytes(32).toString("base64url"),
    ];
    const headers = (index = 0) => ({
      origin,
      cookie: `remote_session=${browsers[index]}`,
    });
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    let instance = randomUUID();
    let address = 1;
    const base = () => ({
      version: 1 as const,
      machineId: machine,
      timestamp: Date.now(),
      nonce: randomUUID(),
      signature: "",
    });
    const post = (path: string, payload: object = {}, index = 0) =>
      app!.inject({
        method: "POST",
        url: path,
        headers: headers(index),
        payload,
        remoteAddress: `198.51.100.${address++}`,
      });
    const status = (id: string, index = 0) =>
      app!.inject({
        method: "GET",
        url: `/api/signin/leases/${id}/handoff`,
        headers: headers(index),
      });
    const readyWorker = async () => {
      instance = randomUUID();
      const worker = generateKeyPairSync("ed25519");
      const beat = {
        ...base(),
        instanceId: instance,
        consoleSessionId: 3,
        state: "sign-in" as const,
        workerReady: true,
        workerPublicKey: raw(worker).toString("base64"),
      };
      beat.signature = signature(endpoint, signinHeartbeatMessage(beat));
      assert.equal((await post("/api/signin/heartbeat", beat)).statusCode, 200);
      const grant = await post(`/api/machines/${machine}/signin-leases`);
      assert.equal(grant.statusCode, 200);
      return grant.json().id as string;
    };
    const proof = (id: string, keys = endpoint) => {
      const value = {
        ...base(),
        leaseId: id,
        instanceId: instance,
        consoleSessionId: 3,
      };
      value.signature = signature(keys, signinHandoffMessage(value));
      return value;
    };
    const host = async (consoleId: number) => {
      const beat = {
        ...base(),
        instanceId: hostInstance,
        consoleSessionId: consoleId,
      };
      beat.signature = signature(
        user,
        heartbeatMessage(
          machine,
          beat.timestamp,
          beat.nonce,
          hostInstance,
          consoleId,
        ),
      );
      assert.equal((await post("/api/agent/heartbeat", beat)).statusCode, 200);
    };
    const hostInstance = randomUUID();
    try {
      await applyMigrations(pool);
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      for (const browser of browsers)
        await pool.query(
          "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
          [createHash("sha256").update(browser).digest("hex"), account],
        );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Handoff fixture',$3)",
        [machine, account, raw(user)],
      );
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
        [machine],
      );
      app = await createApp(pool, {
        DATABASE_URL: url,
        WEB_ORIGIN: origin,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: 3010,
        SESSION_SECRET: randomBytes(32).toString("hex"),
        CONTROL_ENABLED: "true",
        SIGNIN_AUTHORITY_ENABLED: "true",
        SIGNIN_MEDIA_ENABLED: "true",
      });
      await app.ready();
      const binding = {
        ...base(),
        publicKey: raw(endpoint).toString("base64"),
      };
      binding.signature = signature(user, signinBindingMessage(binding));
      assert.equal(
        (await post("/api/agent/signin-binding", binding)).statusCode,
        200,
      );
      const id = await readyWorker();
      assert.deepEqual((await status(id)).json(), { state: "pending" });
      assert.equal((await status(id, 1)).statusCode, 404);
      assert.equal(
        (await post("/api/signin/handoff", proof(id, user))).statusCode,
        401,
      );
      const attestation = proof(id);
      assert.equal(
        (
          await post("/api/signin/handoff", {
            ...attestation,
            consoleSessionId: 4,
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (await post("/api/signin/handoff", attestation)).statusCode,
        200,
      );
      assert.equal(
        (await post("/api/signin/handoff", attestation)).statusCode,
        409,
      );
      assert.equal(
        (await post("/api/signin/handoff", proof(id))).statusCode,
        409,
        "fresh nonce cannot extend the transition",
      );
      const presence = {
        ...base(),
        instanceId: randomUUID(),
        consoleSessionId: 3,
        state: "signed-in" as const,
        workerReady: false,
        workerPublicKey: null,
      };
      presence.signature = signature(
        endpoint,
        signinHeartbeatMessage(presence),
      );
      assert.equal(
        (await post("/api/signin/heartbeat", presence)).statusCode,
        200,
      );
      assert.deepEqual(
        (await status(id)).json(),
        { state: "pending" },
        "ordinary host is not inferred from service presence",
      );
      await host(4);
      assert.deepEqual((await status(id)).json(), { state: "pending" });
      await host(3);
      const transition = (await status(id)).json();
      assert.equal(transition.state, "ready");
      assert.equal(transition.instanceId, instance);
      const request = {
        source: "desktop",
        capability: "desktop:control",
        requirePolicy: true,
        hostContext: transition.hostContext,
        signinLeaseId: id,
      };
      assert.equal(
        (await post(`/api/machines/${machine}/sessions`, request, 1))
          .statusCode,
        409,
      );
      const desktop = await post(`/api/machines/${machine}/sessions`, request);
      assert.equal(desktop.statusCode, 200);
      assert.equal(desktop.json().approval, "policy");
      assert.equal(
        (await post(`/api/machines/${machine}/sessions`, request)).statusCode,
        409,
      );
      const desktopId = desktop.json().id as string;
      await assert.rejects(
        app.injectWS(`/api/sessions/${desktopId}/signal?role=viewer`, {
          headers: headers(1),
        }),
      );
      const viewer = await app.injectWS(
        `/api/sessions/${desktopId}/signal?role=viewer`,
        { headers: headers() },
      );
      const closed = once(viewer, "close", {
        signal: AbortSignal.timeout(3000),
      });
      const consent = await pool.connect();
      try {
        await consent.query("BEGIN; SET LOCAL statement_timeout='3s'");
        await consent.query(
          "UPDATE view_sessions SET status='connecting' WHERE id=$1",
          [desktopId],
        );
        const stopping = post(`/api/signin/leases/${id}/stop`);
        let waiting = false;
        const until = performance.now() + 2000;
        while (performance.now() < until) {
          waiting = Boolean(
            (
              await pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%UPDATE view_sessions SET status=%'",
                [schema],
              )
            ).rowCount,
          );
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(waiting, "Stop reaches an overlapping native consent update");
        await consent.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'fixture.handoff-consent')",
          [account, machine],
        );
        await consent.query("COMMIT");
        assert.equal((await stopping).statusCode, 200);
      } finally {
        await consent.query("ROLLBACK");
        consent.release();
      }
      await closed;
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            desktopId,
          ])
        ).rows[0].status,
        "ended",
      );
      const stopped = await readyWorker();
      await post(`/api/signin/leases/${stopped}/stop`);
      assert.equal(
        (await post("/api/signin/handoff", proof(stopped))).statusCode,
        409,
      );
      const expired = await readyWorker();
      await pool.query(
        "UPDATE signin_leases SET expires_at=now()-interval '1 second' WHERE id=$1",
        [expired],
      );
      assert.equal(
        (await post("/api/signin/handoff", proof(expired))).statusCode,
        409,
      );
      const transport = await readyWorker();
      await pool.query(
        "UPDATE signin_leases SET ended_at=now(),ended_reason='transport' WHERE id=$1",
        [transport],
      );
      assert.equal(
        (await post("/api/signin/handoff", proof(transport))).statusCode,
        200,
        "teardown transport close may precede attestation",
      );
      const disable = async () => {
        const value = base();
        value.signature = signature(endpoint, signinDisableMessage(value));
        assert.equal(
          (await post("/api/signin/disable", value)).statusCode,
          200,
        );
      };
      await disable();
      assert.equal(
        (await status(transport)).statusCode,
        404,
        "local Disable cancels pending handoff",
      );
      assert.equal(
        (
          await post(`/api/machines/${machine}/sessions`, {
            ...request,
            signinLeaseId: transport,
          })
        ).statusCode,
        409,
      );
      const rebind = async () => {
        const value = {
          ...base(),
          publicKey: raw(endpoint).toString("base64"),
        };
        value.signature = signature(user, signinBindingMessage(value));
        assert.equal(
          (await post("/api/agent/signin-binding", value)).statusCode,
          200,
        );
      };
      await rebind();
      const transferred = await readyWorker();
      assert.equal(
        (await post("/api/signin/handoff", proof(transferred))).statusCode,
        200,
      );
      await host(3);
      const nextDesktop = await post(`/api/machines/${machine}/sessions`, {
        ...request,
        signinLeaseId: transferred,
      });
      assert.equal(nextDesktop.statusCode, 200);
      const nextViewer = await app.injectWS(
        `/api/sessions/${nextDesktop.json().id}/signal?role=viewer`,
        { headers: headers() },
      );
      const nextClosed = once(nextViewer, "close");
      const disableConsent = await pool.connect();
      try {
        await disableConsent.query("BEGIN");
        await disableConsent.query(
          "UPDATE view_sessions SET status='connecting' WHERE id=$1",
          [nextDesktop.json().id],
        );
        const disabling = disable();
        let waiting = false;
        const until = performance.now() + 2000;
        while (performance.now() < until) {
          waiting = Boolean(
            (
              await pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%UPDATE view_sessions SET status=%'",
                [schema],
              )
            ).rowCount,
          );
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(waiting, "local Disable reaches overlapping desktop consent");
        await disableConsent.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'fixture.disable-consent')",
          [account, machine],
        );
        await disableConsent.query("COMMIT");
        await disabling;
      } finally {
        await disableConsent.query("ROLLBACK");
        disableConsent.release();
      }
      await nextClosed;
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            nextDesktop.json().id,
          ])
        ).rows[0].status,
        "ended",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT allow_control FROM machine_access WHERE machine_id=$1",
            [machine],
          )
        ).rows[0].allow_control,
        true,
        "sign-in Disable preserves separate ordinary owner policy",
      );
      await rebind();
      const policyTransition = await readyWorker();
      assert.equal(
        (await post("/api/signin/handoff", proof(policyTransition))).statusCode,
        200,
      );
      await pool.query(
        "UPDATE machine_access SET mode='attended',allow_control=false,version=version+1 WHERE machine_id=$1",
        [machine],
      );
      assert.equal((await status(policyTransition)).statusCode, 404);
      assert.equal(
        (
          await post(`/api/machines/${machine}/sessions`, {
            ...request,
            signinLeaseId: policyTransition,
          })
        ).statusCode,
        409,
      );
    } finally {
      await app?.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
