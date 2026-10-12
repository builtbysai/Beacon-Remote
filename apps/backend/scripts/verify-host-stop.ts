// Actual native helper + anonymous host pipe + real signaling/database.
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { WebSocket } from "ws";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { createApp } from "../src/app.js";
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

assert.equal(process.platform, "win32");
const database = process.env.TEST_DATABASE_URL;
assert.ok(database && new URL(database).pathname.endsWith("_test"));
const admin = new Pool({ connectionString: database });
const schema = `host_stop_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: database,
  options: `-c search_path=${schema}`,
});
const origin = "http://127.0.0.1:13012";
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let child: ReturnType<typeof spawn> | undefined;
let viewer: WebSocket | undefined;
async function wait(check: () => Promise<boolean>) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error("Native graceful stop did not complete");
}
try {
  for (const file of [
    "001_identity.sql",
    "002_view_sessions.sql",
    "003_control_scope.sql",
    "004_development_session_duration.sql",
  ])
    await pool.query(
      await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  const account = randomUUID();
  const machine = randomUUID();
  const keys = generateKeyPairSync("ed25519");
  const email = `${account}@example.test`,
    password = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [account, email, await hash(password)],
  );
  await pool.query(
    "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Host pipe acceptance',$3,now())",
    [
      machine,
      account,
      keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
    ],
  );
  app = await createApp(pool, {
    DATABASE_URL: database!,
    WEB_ORIGIN: origin,
    HOST: "127.0.0.1",
    PORT: 13012,
    NODE_ENV: "test",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    STUN_URL: "stun:stun.l.google.com:19302",
  });
  await app.listen({ host: "127.0.0.1", port: 13012 });
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  for (const source of ["synthetic", "desktop"] as const) {
    const requested = await fetch(
      `${origin}/api/machines/${machine}/sessions`,
      {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify({ source }),
      },
    );
    assert.equal(requested.status, 200);
    const session = (await requested.json()) as { id: string };
    // Use the real machine pending adapter, not a fabricated helper token.
    const timestamp = Date.now(),
      nonce = randomUUID();
    const beat = await fetch(`${origin}/api/agent/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        machineId: machine,
        timestamp,
        nonce,
        signature: sign(
          null,
          Buffer.from(heartbeatMessage(machine, timestamp, nonce)),
          keys.privateKey,
        ).toString("base64"),
      }),
    });
    assert.equal(beat.status, 200);
    const nativeGrant = (
      (await beat.json()) as { sessions: Record<string, unknown>[] }
    ).sessions[0];
    assert.ok(nativeGrant);
    let consent = false;
    viewer = await app.injectWS(
      `/api/sessions/${session.id}/signal?role=viewer`,
      { headers: { origin, cookie } },
    );
    viewer.on("message", (data) => {
      const body = JSON.parse(data.toString()) as {
        type: string;
        accepted?: boolean;
      };
      if (body.type === "consent" && body.accepted) consent = true;
    });
    child = spawn(
      resolve(
        import.meta.dirname,
        "../../../target/release/beacon-remote-session.exe",
      ),
      ["media-host"],
      { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] },
    );
    let exit: number | null | undefined;
    child.once("exit", (code) => {
      exit = code;
    });
    child.stdin!.write(
      `${JSON.stringify({ ...nativeGrant, server: origin })}\n`,
    );
    await wait(
      async () =>
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            session.id,
          ])
        ).rows[0]?.status ===
        (source === "synthetic" ? "active" : "connecting"),
    );
    if (source === "synthetic") {
      await wait(async () => consent);
      child.stdin!.write("stop\n");
    } else child.stdin!.end(); // Pipe EOF cancels pending native consent; no Allow is clicked.
    await wait(async () => exit !== undefined);
    assert.equal(exit, 0);
    await wait(
      async () =>
        (
          await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
            session.id,
          ])
        ).rows[0]?.status === "ended",
    );
    viewer.close();
    viewer = undefined;
    child = undefined;
  }
  console.log(
    "Actual native host Stop ended synthetic signaling; pipe EOF cancelled pending desktop consent. Both helpers exited without forced termination.",
  );
} finally {
  viewer?.close();
  child?.stdin?.end();
  if (child && child.exitCode === null) {
    await delay(10000);
    if (child.exitCode === null) child.kill();
  }
  await app?.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
