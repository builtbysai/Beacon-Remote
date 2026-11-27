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
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

test(
  "signed ordinary console context pins fresh policy grants and cannot revive after host changes or downgrade",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.equal(new URL(url).hostname, "127.0.0.1");
    assert.match(new URL(url).pathname, /_test$/);
    const admin = new Pool({ connectionString: url });
    const schema = `host_console_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
      application_name: schema,
    });
    const origin = "https://remote.example.test",
      account = randomUUID(),
      machine = randomUUID();
    const keys = generateKeyPairSync("ed25519"),
      browser = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${browser}` };
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    const sockets: WebSocket[] = [];
    let instance = randomUUID(),
      consoleId: number | null | undefined = 3,
      address = 1;
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const heartbeat = () => {
      const timestamp = Date.now(),
        nonce = randomUUID();
      return {
        version: 1,
        machineId: machine,
        timestamp,
        nonce,
        instanceId: instance,
        consoleSessionId: consoleId,
        signature: sign(
          null,
          Buffer.from(
            heartbeatMessage(machine, timestamp, nonce, instance, consoleId),
          ),
          keys.privateKey,
        ).toString("base64"),
      };
    };
    const beat = () =>
      app!.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: heartbeat(),
      });
    const create = (payload: object = {}) =>
      app!.inject({
        method: "POST",
        url: `/api/machines/${machine}/sessions`,
        headers,
        remoteAddress: `198.51.100.${address++}`,
        payload: {
          source: "desktop",
          capability: "desktop:control",
          requirePolicy: true,
          hostContext: { instanceId: instance, consoleSessionId: 3 },
          ...payload,
        },
      });
    const connect = async (
      id: string,
      role: string,
      requestHeaders: Record<string, string>,
    ) => {
      const socket = new WebSocket(
        `${websocketOrigin}/api/sessions/${id}/signal?role=${role}`,
        { headers: requestHeaders },
      );
      sockets.push(socket);
      await once(socket, "open", { signal: AbortSignal.timeout(3000) });
      return socket;
    };
    const reply = async (socket: WebSocket, body: object) => {
      const next = once(socket, "message", {
        signal: AbortSignal.timeout(3000),
      });
      socket.send(JSON.stringify(body));
      return JSON.parse((await next)[0].toString());
    };
    let websocketOrigin = "";
    try {
      await applyMigrations(pool);
      await applyMigrations(pool);
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [account, `${account}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [digest(browser), account],
      );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Console fixture',$3)",
        [
          machine,
          account,
          keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
        ],
      );
      app = await createApp(pool, {
        DATABASE_URL: url,
        WEB_ORIGIN: origin,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: 3010,
        SESSION_SECRET: randomBytes(32).toString("hex"),
        CONTROL_ENABLED: "true",
      });
      websocketOrigin = (
        await app.listen({ host: "127.0.0.1", port: 0 })
      ).replace("http:", "ws:");
      const signed = heartbeat();
      for (const altered of [undefined, null, 4]) {
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/agent/heartbeat",
              payload: { ...signed, consoleSessionId: altered },
            })
          ).statusCode,
          401,
          "console cannot be stripped/substituted",
        );
      }
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/heartbeat",
            payload: signed,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/heartbeat",
            payload: signed,
          })
        ).statusCode,
        409,
        "nonce cannot refresh context twice",
      );
      for (const invalid of [
        { ...signed, consoleSessionId: 0 },
        { ...signed, consoleSessionId: 0xffffffff },
        { ...signed, instanceId: undefined },
      ])
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/agent/heartbeat",
              payload: invalid,
            })
          ).statusCode,
          400,
        );
      const inventory = (
        await app.inject({ method: "GET", url: "/api/machines", headers })
      ).json().machines;
      assert.equal(inventory[0].hostConsoleSessionId, 3);
      // The computer's identity key reaches the owner's browser for pinning (ADR 0061): URL-safe base64, 32 bytes.
      assert.equal(
        inventory[0].identityKey,
        keys.publicKey
          .export({ format: "der", type: "spki" })
          .subarray(-32)
          .toString("base64url"),
      );
      assert.equal(inventory[0].hostInstanceId, instance);
      assert.equal((await create({ requirePolicy: false })).statusCode, 400);
      assert.equal(
        (await create({ source: "synthetic", capability: "desktop:view" }))
          .statusCode,
        400,
      );
      assert.equal(
        (await create()).statusCode,
        403,
        "pinning never supplies unattended permission",
      );
      await pool.query(
        "INSERT INTO machine_access(machine_id,mode,allow_control) VALUES ($1,'trusted',true)",
        [machine],
      );
      for (const hostContext of [
        { instanceId: randomUUID(), consoleSessionId: 3 },
        { instanceId: instance, consoleSessionId: 4 },
      ])
        assert.equal((await create({ hostContext })).statusCode, 409);
      const grant = await create();
      assert.equal(grant.statusCode, 200);
      assert.equal(grant.json().approval, "policy");
      const id = grant.json().id as string;
      const pending = (await beat())
        .json()
        .sessions.find((entry: { id: string }) => entry.id === id);
      assert.ok(pending?.token);
      const viewer = await connect(id, "viewer", headers);
      const native = await connect(id, "machine", {
        authorization: `Bearer ${pending.token}`,
      });
      const consent = once(viewer, "message", {
        signal: AbortSignal.timeout(3000),
      });
      native.send(
        JSON.stringify({ type: "consent", accepted: true, control: true }),
      );
      assert.equal(JSON.parse((await consent)[0].toString()).type, "consent");
      assert.equal(
        (await reply(native, { type: "renew", nonce: "1" })).type,
        "lease",
      );
      const closed = once(native, "close", {
        signal: AbortSignal.timeout(3000),
      });
      const transitioning = await pool.connect();
      try {
        await transitioning.query("BEGIN; SET LOCAL statement_timeout='3s'");
        await transitioning.query(
          "UPDATE view_sessions SET status='active' WHERE id=$1",
          [id],
        );
        consoleId = 4;
        const changed = beat();
        const until = performance.now() + 2000;
        let waiting = false;
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
        assert.ok(
          waiting,
          "heartbeat reaches the row held by the consent transition",
        );
        // Mirrors the consent CTE's audit insert after locking its session row.
        // Its machine FK must finish while heartbeat waits on that same row.
        await transitioning.query(
          "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,'fixture.context-transition')",
          [account, machine],
        );
        await transitioning.query("COMMIT");
        assert.equal((await changed).statusCode, 200);
      } finally {
        await transitioning.query("ROLLBACK");
        transitioning.release();
      }
      if (native.readyState === WebSocket.OPEN)
        native.send(JSON.stringify({ type: "renew", nonce: "2" }));
      await closed;
      assert.equal(
        (await pool.query("SELECT status FROM view_sessions WHERE id=$1", [id]))
          .rows[0].status,
        "ended",
      );
      consoleId = 3;
      await beat();
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: `/api/sessions/${id}/signal?role=viewer`,
            headers: {
              ...headers,
              upgrade: "websocket",
              connection: "Upgrade",
            },
          })
        ).statusCode,
        403,
      );
      const second = await create();
      assert.equal(second.statusCode, 200);
      consoleId = undefined;
      await beat();
      assert.equal(
        (
          await pool.query(
            "SELECT host_console_session_id FROM machines WHERE id=$1",
            [machine],
          )
        ).rows[0].host_console_session_id,
        null,
      );
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            second.json().id,
          ])
        ).rows[0].status,
        "ended",
      );
      consoleId = 3;
      await beat();
      const third = await create();
      assert.equal(third.statusCode, 200);
      instance = randomUUID();
      await beat();
      assert.equal(
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            third.json().id,
          ])
        ).rows[0].status,
        "ended",
      );
      consoleId = null;
      await beat();
      assert.equal(
        (await create()).statusCode,
        409,
        "explicit unavailable cannot satisfy a console pin",
      );
      const ordinary = await create({ hostContext: undefined });
      assert.equal(
        ordinary.statusCode,
        200,
        "ordinary grants retain existing policy behavior",
      );
      assert.ok(
        (
          await pool.query(
            "SELECT 1 FROM audit_events WHERE machine_id=$1 AND action='desktop.control.interrupted:host-context-changed'",
            [machine],
          )
        ).rowCount,
      );
    } finally {
      for (const socket of sockets) socket.terminate();
      await app?.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
