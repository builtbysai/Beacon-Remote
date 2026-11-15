import assert from "node:assert/strict";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";
import {
  signinBindingMessage,
  signinHeartbeatMessage,
  signinLeaseProofMessage,
  signinWorkerConnectMessage,
} from "../../../packages/protocol/src/index.js";

test(
  "sign-in signaling binds worker key and exact browser, then ends on protocol, authority or peer loss",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 60_000,
  },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.match(url.pathname, /_test$/);
    const admin = new Pool({ connectionString: url.toString() });
    const schema = `signin_signal_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: url.toString(),
      options: `-c search_path=${schema}`,
      application_name: schema,
    });
    const origin = "https://remote.example.test",
      account = randomUUID(),
      stranger = randomUUID(),
      machine = randomUUID();
    const browser = randomBytes(32).toString("base64url"),
      otherBrowser = randomBytes(32).toString("base64url"),
      alienBrowser = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${browser}` };
    const user = generateKeyPairSync("ed25519"),
      endpoint = generateKeyPairSync("ed25519"),
      boot = generateKeyPairSync("ed25519");
    let worker = generateKeyPairSync("ed25519"),
      instance = randomUUID();
    const raw = (key: typeof user) =>
      key.publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64");
    const signature = (key: typeof user, message: string) =>
      sign(null, Buffer.from(message), key.privateKey).toString("base64");
    const base = () => ({
      version: 1 as const,
      machineId: machine,
      timestamp: Date.now(),
      nonce: randomUUID(),
      signature: "",
    });
    const config = {
      DATABASE_URL: url.toString(),
      WEB_ORIGIN: origin,
      NODE_ENV: "test" as const,
      HOST: "127.0.0.1",
      PORT: 3010,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true" as const,
      SIGNIN_AUTHORITY_ENABLED: "true" as const,
      SIGNIN_MEDIA_ENABLED: "true" as const,
      TURN_URLS: ["turn:relay.example.test:3478?transport=udp"],
      TURN_SECRET: randomBytes(32).toString("hex"),
      ICE_TRANSPORT_POLICY: "relay" as const,
    };
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    const sockets: WebSocket[] = [];
    const messages = new Map<WebSocket, Record<string, unknown>[]>();
    let wsOrigin = "";
    async function until(
      check: () => boolean | Promise<boolean>,
      timeout = 5000,
    ) {
      const deadline = performance.now() + timeout;
      while (!(await check())) {
        if (performance.now() >= deadline)
          throw new Error("Sign-in fixture observation timed out");
        await delay(10);
      }
    }
    const next = async (socket: WebSocket, type: string) => {
      await until(() =>
        messages.get(socket)!.some((message) => message.type === type),
      );
      const queue = messages.get(socket)!;
      return queue.splice(
        queue.findIndex((message) => message.type === type),
        1,
      )[0]!;
    };
    const path = (id: string, role: string) =>
      `/api/signin/leases/${id}/signal?role=${role}`;
    async function connect(
      id: string,
      role: string,
      requestHeaders: Record<string, string>,
      autoPong = true,
    ) {
      const socket = new WebSocket(wsOrigin + path(id, role), {
        headers: requestHeaders,
        autoPong,
      });
      sockets.push(socket);
      socket.on("error", () => {});
      messages.set(socket, []);
      socket.on("message", (data) =>
        messages.get(socket)!.push(JSON.parse(data.toString())),
      );
      await once(socket, "open", { signal: AbortSignal.timeout(5000) });
      return socket;
    }
    async function refused(
      id: string,
      role: string,
      requestHeaders: Record<string, string>,
    ) {
      return new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(wsOrigin + path(id, role), {
          headers: requestHeaders,
        });
        sockets.push(socket);
        const timer = setTimeout(() => {
          socket.terminate();
          reject(new Error("Expected refused upgrade timed out"));
        }, 5000);
        socket.on("unexpected-response", (_request, response) => {
          clearTimeout(timer);
          response.resume();
          socket.terminate();
          resolve(response.statusCode ?? 0);
        });
        socket.on("open", () => {
          clearTimeout(timer);
          socket.terminate();
          reject(new Error("Unexpected sign-in upgrade"));
        });
        socket.on("error", () => {});
      });
    }
    const proof = (
      id: string,
      key = worker,
      purpose = "worker",
      extra: Partial<{
        timestamp: number;
        machineId: string;
        instanceId: string;
        consoleSessionId: number;
      }> = {},
    ) => {
      const value = {
        ...base(),
        leaseId: id,
        instanceId: instance,
        consoleSessionId: 1,
        ...extra,
      };
      value.signature = signature(
        key,
        purpose === "worker"
          ? signinWorkerConnectMessage(value)
          : signinLeaseProofMessage(value),
      );
      return {
        authorization: `Beacon-SignIn ${Buffer.from(JSON.stringify(value)).toString("base64url")}`,
      };
    };
    const post = (
      route: string,
      payload: object,
      requestHeaders: Record<string, string> = headers,
    ) =>
      app!.inject({
        method: "POST",
        url: route,
        payload,
        headers: requestHeaders,
      });
    async function presence(legacy = false) {
      const heartbeat = {
        ...base(),
        instanceId: instance,
        consoleSessionId: 1,
        state: "sign-in" as const,
        workerReady: true,
        ...(legacy ? {} : { workerPublicKey: raw(worker) }),
      };
      heartbeat.signature = signature(
        endpoint,
        signinHeartbeatMessage(heartbeat),
      );
      assert.equal(
        (await post("/api/signin/heartbeat", heartbeat, {})).statusCode,
        200,
      );
    }
    async function reserve() {
      const response = await post(`/api/machines/${machine}/signin-leases`, {});
      assert.equal(response.statusCode, 200);
      return response.json().id as string;
    }
    async function freshPair() {
      instance = randomUUID();
      worker = generateKeyPairSync("ed25519");
      await presence();
      const id = await reserve();
      const host = await connect(id, "worker", proof(id));
      const viewer = await connect(id, "viewer", headers);
      await until(() => messages.get(viewer)!.length > 0);
      assert.equal(messages.get(viewer)![0]!.type, "ready");
      await next(host, "peer-ready");
      await next(viewer, "peer-ready");
      return { id, host, viewer };
    }
    async function ended(id: string, ...peers: WebSocket[]) {
      await until(() =>
        peers.every((peer) => peer.readyState === WebSocket.CLOSED),
      );
      await until(async () => {
        const result = await pool.query(
          "SELECT ended_at FROM signin_leases WHERE id=$1",
          [id],
        );
        return !result.rowCount || Boolean(result.rows[0].ended_at);
      });
    }
    try {
      await applyMigrations(pool);
      for (const [id, email] of [
        [account, "owner@example.test"],
        [stranger, "stranger@example.test"],
      ])
        await pool.query(
          "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
          [id, email],
        );
      for (const [token, id] of [
        [browser, account],
        [otherBrowser, account],
        [alienBrowser, stranger],
      ])
        await pool.query(
          "INSERT INTO browser_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
          [createHash("sha256").update(token!).digest("hex"), id],
        );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'signaling fixture',$3)",
        [machine, account, Buffer.from(raw(user), "base64")],
      );
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
        [machine],
      );
      await pool.query(
        "INSERT INTO boot_agents(machine_id,public_key) VALUES ($1,$2)",
        [machine, Buffer.from(raw(boot), "base64")],
      );
      const disabled = await createApp(pool, {
        ...config,
        SIGNIN_AUTHORITY_ENABLED: undefined,
        SIGNIN_MEDIA_ENABLED: undefined,
      });
      assert.equal(
        (
          await disabled.inject({
            url: path(randomUUID(), "viewer"),
            headers: { upgrade: "websocket" },
          })
        ).statusCode,
        503,
      );
      await disabled.close();
      app = await createApp(pool, config);
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      wsOrigin = address.replace("http:", "ws:");
      const binding = { ...base(), publicKey: raw(endpoint) };
      binding.signature = signature(user, signinBindingMessage(binding));
      assert.equal(
        (await post("/api/agent/signin-binding", binding, {})).statusCode,
        200,
      );
      await presence(true);
      const legacy = randomUUID();
      assert.equal(
        (await post(`/api/machines/${machine}/signin-leases`, {})).statusCode,
        404,
        "legacy presence without a worker identity cannot reserve connectable media",
      );
      assert.equal(await refused(legacy, "viewer", headers), 403);
      assert.equal(await refused(legacy, "worker", proof(legacy)), 403);

      await presence();
      const id = await reserve();
      for (const key of [user, boot, endpoint])
        assert.equal(await refused(id, "worker", proof(id, key)), 403);
      assert.equal(
        await refused(id, "worker", proof(id, worker, "service")),
        403,
      );
      for (const extra of [
        { timestamp: Date.now() - 31000 },
        { machineId: randomUUID() },
        { instanceId: randomUUID() },
        { consoleSessionId: 2 },
      ])
        assert.equal(
          await refused(id, "worker", proof(id, worker, "worker", extra)),
          403,
        );
      assert.equal(
        await refused(id, "worker", { ...proof(id), cookie: headers.cookie }),
        403,
      );
      assert.equal(await refused(id, "worker&token=forbidden", proof(id)), 403);
      assert.equal(await refused(id, "worker", { ...proof(id), origin }), 403);
      assert.equal(
        await refused(id, "viewer", {
          ...headers,
          origin: "https://attacker.example",
        }),
        403,
      );
      assert.equal(
        await refused(id, "viewer", {
          origin,
          cookie: `remote_session=${otherBrowser}`,
        }),
        403,
      );
      assert.equal(
        await refused(id, "viewer", {
          origin,
          cookie: `remote_session=${alienBrowser}`,
        }),
        403,
      );
      const upgrade = proof(id);
      const host = await connect(id, "worker", upgrade);
      const hostReady = await next(host, "ready");
      assert.equal(hostReady.scope, "windows:sign-in");
      assert.equal(hostReady.workerPublicKey, raw(worker));
      for (const capability of [
        "files",
        "clipboard",
        "audio",
        "recording",
        "automation",
      ])
        assert.equal(hostReady[capability], false);
      const ice = hostReady.iceServers as {
        username?: string;
        credential?: string;
      }[];
      assert.equal(
        ice[1]!.credential,
        createHmac("sha1", config.TURN_SECRET)
          .update(ice[1]!.username!)
          .digest("base64"),
      );
      assert.equal(hostReady.iceTransportPolicy, "relay");
      assert.equal(await refused(id, "worker", upgrade), 409);
      assert.equal(await refused(id, "worker", proof(id)), 409);
      const viewer = await connect(id, "viewer", headers);
      await next(host, "peer-ready");
      await next(viewer, "peer-ready");
      assert.equal(await refused(id, "viewer", headers), 409);
      const offer = {
        type: "offer",
        sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
      };
      host.send(JSON.stringify(offer));
      assert.deepEqual(await next(viewer, "offer"), offer);
      const answer = {
        type: "answer",
        sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
      };
      viewer.send(JSON.stringify(answer));
      assert.deepEqual(await next(host, "answer"), answer);
      const candidate = {
        type: "candidate",
        candidate: "candidate:fixture",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      viewer.send(JSON.stringify(candidate));
      assert.deepEqual(await next(host, "candidate"), candidate);
      viewer.send(JSON.stringify(offer)); // The viewer cannot become an offer-producing worker.
      await ended(id, host, viewer);

      const explicit = await freshPair();
      assert.equal(
        (await post(`/api/signin/leases/${explicit.id}/stop`, {})).statusCode,
        200,
      );
      await ended(explicit.id, explicit.host, explicit.viewer);
      const racing = await freshPair();
      const machineLocker = await pool.connect();
      let renewal: Promise<{ statusCode: number }> | undefined;
      try {
        await machineLocker.query("BEGIN");
        await machineLocker.query(
          "SELECT id FROM machines WHERE id=$1 FOR UPDATE",
          [machine],
        );
        racing.viewer.close();
        await until(
          async () =>
            Number(
              (
                await pool.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                  [schema],
                )
              ).rows[0].n,
            ) >= 1,
        );
        renewal = Promise.resolve(
          post(`/api/signin/leases/${racing.id}/renew`, {}),
        );
        await until(
          async () =>
            Number(
              (
                await pool.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                  [schema],
                )
              ).rows[0].n,
            ) >= 2,
        );
      } finally {
        await machineLocker.query("ROLLBACK");
        machineLocker.release();
      }
      assert.equal((await renewal!).statusCode, 404);
      await ended(racing.id, racing.host, racing.viewer);
      const lost = await freshPair();
      lost.viewer.close();
      await ended(lost.id, lost.host, lost.viewer);
      const expired = await freshPair();
      await pool.query(
        "UPDATE signin_leases SET expires_at=now()-interval '1 second' WHERE id=$1",
        [expired.id],
      );
      await ended(expired.id, expired.host, expired.viewer);
      const stalled = await freshPair();
      await pool.query(
        "UPDATE signin_leases SET expires_at=now()+interval '2 seconds' WHERE id=$1",
        [stalled.id],
      );
      stalled.viewer.send(JSON.stringify(candidate));
      await next(stalled.host, "candidate");
      const locker = await pool.connect();
      try {
        const oid = (
          await locker.query("SELECT 'signin_leases'::regclass::oid AS oid")
        ).rows[0].oid;
        await locker.query(
          "BEGIN; LOCK TABLE signin_leases IN ACCESS EXCLUSIVE MODE",
        );
        await until(async () =>
          Boolean(
            (
              await pool.query(
                "SELECT 1 FROM pg_locks WHERE relation=$1 AND NOT granted",
                [oid],
              )
            ).rowCount,
          ),
        );
        assert.equal(stalled.host.readyState, WebSocket.OPEN);
        await until(
          () =>
            stalled.host.readyState === WebSocket.CLOSED &&
            stalled.viewer.readyState === WebSocket.CLOSED,
        );
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
      }
      await ended(stalled.id, stalled.host, stalled.viewer);
      const lowered = await freshPair();
      await pool.query(
        "UPDATE machine_access SET version=version+1 WHERE machine_id=$1",
        [machine],
      );
      await ended(lowered.id, lowered.host, lowered.viewer);
      const unknown = await freshPair();
      unknown.viewer.send(JSON.stringify({ type: "renew", files: true }));
      await ended(unknown.id, unknown.host, unknown.viewer);
      const binary = await freshPair();
      binary.viewer.send(Buffer.from("forbidden binary"));
      await ended(binary.id, binary.host, binary.viewer);
      const flooded = await freshPair();
      for (let i = 0; i < 300; i++)
        flooded.viewer.send(JSON.stringify(candidate));
      await ended(flooded.id, flooded.host, flooded.viewer);
      instance = randomUUID();
      worker = generateKeyPairSync("ed25519");
      await presence();
      const silentId = await reserve();
      const silentHost = await connect(silentId, "worker", proof(silentId));
      const silentViewer = await connect(silentId, "viewer", headers, false);
      await next(silentHost, "peer-ready");
      await next(silentViewer, "peer-ready");
      await until(
        () =>
          silentHost.readyState === WebSocket.CLOSED &&
          silentViewer.readyState === WebSocket.CLOSED,
        7500,
      );
      await ended(silentId, silentHost, silentViewer);
      assert.equal(
        (
          await pool.query(
            "SELECT expires_at>now() AS was_live FROM signin_leases WHERE id=$1",
            [silentId],
          )
        ).rows[0].was_live,
        true,
      );
      const auditFailure = await freshPair();
      await pool.query(`CREATE SEQUENCE end_audit_attempts;
        CREATE FUNCTION reject_transport_end() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.action='signin.transport.ended' THEN
            PERFORM nextval('end_audit_attempts');
            RAISE EXCEPTION 'fixture audit unavailable';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER reject_transport_end BEFORE INSERT ON audit_events
          FOR EACH ROW EXECUTE FUNCTION reject_transport_end()`);
      auditFailure.viewer.close();
      await until(
        () =>
          auditFailure.host.readyState === WebSocket.CLOSED &&
          auditFailure.viewer.readyState === WebSocket.CLOSED,
      );
      // Sequence increments survive rollback and prove the real trigger ran.
      await until(async () =>
        Boolean(
          (await pool.query("SELECT is_called FROM end_audit_attempts")).rows[0]
            .is_called,
        ),
      );
      assert.deepEqual(
        (
          await pool.query(
            "SELECT ended_at IS NULL AS rolled_back,expires_at>now() AS was_live FROM signin_leases WHERE id=$1",
            [auditFailure.id],
          )
        ).rows[0],
        { rolled_back: true, was_live: true },
      );
      assert.equal(
        await refused(auditFailure.id, "worker", proof(auditFailure.id)),
        403,
      );
      await pool.query(
        "DROP TRIGGER reject_transport_end ON audit_events; DROP FUNCTION reject_transport_end(); DROP SEQUENCE end_audit_attempts",
      );
      await pool.query("UPDATE signin_leases SET ended_at=now() WHERE id=$1", [
        auditFailure.id,
      ]);
      const logout = await freshPair();
      await pool.query("DELETE FROM browser_sessions WHERE token_hash=$1", [
        createHash("sha256").update(browser).digest("hex"),
      ]);
      await ended(logout.id, logout.host, logout.viewer);
    } finally {
      for (const socket of sockets) socket.terminate();
      await app?.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
