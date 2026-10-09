import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { createApp } from "../src/app.js";

// Real executable -> HTTP -> real database. Isolated local state never overwrites
// an already-paired user's identity, and cleanup targets only this test account.
assert.equal(process.platform, "win32", "Native acceptance requires Windows");
const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl, "TEST_DATABASE_URL required");
assert.match(new URL(databaseUrl).pathname, /_test$/);
assert.ok(process.env.NATIVE_AGENT_PATH, "NATIVE_AGENT_PATH required");
const executable = resolve(process.env.NATIVE_AGENT_PATH);
const pool = new Pool({ connectionString: databaseUrl });
const stateDirectory = await mkdtemp(join(tmpdir(), "beacon-remote-native-"));
const accountId = randomUUID();
const email = `${accountId}@example.test`;
const password = randomBytes(24).toString("base64url");
const config = {
  DATABASE_URL: databaseUrl,
  WEB_ORIGIN: "http://127.0.0.1:5174",
  HOST: "127.0.0.1",
  PORT: 13010,
  NODE_ENV: "test" as const,
};
let app = await createApp(pool, config);
let agent: ReturnType<typeof spawn> | undefined;

async function eventually(check: () => Promise<boolean>, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error("Native lifecycle verification timed out");
}

async function pair(code: string) {
  const child = spawn(executable, ["pair"], {
    env: { ...process.env, LOCALAPPDATA: stateDirectory },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  const completed = new Promise<void>((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (status) =>
      status === 0
        ? resolveResult()
        : reject(new Error("Native enrollment failed")),
    );
  });
  child.stdin.end(`http://127.0.0.1:13010\nWindows acceptance PC\n${code}\n`);
  await completed;
}

try {
  await pool.query(
    await readFile(
      new URL("../migrations/001_identity.sql", import.meta.url),
      "utf8",
    ),
  );
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [accountId, email, await hash(password)],
  );
  await app.listen({ host: config.HOST, port: config.PORT });
  const signedIn = await fetch("http://127.0.0.1:13010/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.WEB_ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
  const headers = {
    cookie,
    origin: config.WEB_ORIGIN,
    "content-type": "application/json",
  };
  const pairing = await fetch("http://127.0.0.1:13010/api/enrollments", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(pairing.status, 200);
  const code = ((await pairing.json()) as { code: string }).code;
  await pair(code);
  const state = await readFile(
    join(stateDirectory, "BeaconRemote", "identity.dpapi"),
  );
  assert.ok(state.length > 32);
  assert.ok(
    !state.toString("utf8").includes("secret_key"),
    "Private identity must not be JSON on disk",
  );
  agent = spawn(executable, ["run"], {
    env: { ...process.env, LOCALAPPDATA: stateDirectory },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  agent.stdout?.resume();
  agent.stderr?.resume();
  agent.once("error", (error) => {
    console.error(error.message);
  });
  async function online() {
    const response = await fetch("http://127.0.0.1:13010/api/machines", {
      headers,
    });
    const body = (await response.json()) as {
      machines: { id: string; online: boolean }[];
    };
    return body.machines[0]?.online === true;
  }
  await eventually(online);
  console.log(
    "Native Windows enrollment, DPAPI persistence and signed presence passed.",
  );
  await app.close();
  await delay(17_000); // Force at least one real network failure on the agent.
  app = await createApp(pool, config);
  await app.listen({ host: config.HOST, port: config.PORT });
  await eventually(async () => {
    const result = await pool.query(
      "SELECT last_seen_at > now()-interval '5 seconds' AS recent FROM machines WHERE account_id=$1",
      [accountId],
    );
    return result.rows[0]?.recent === true;
  }, 40_000);
  console.log("Native agent returned online after an actual backend restart.");
  agent.kill();
  await eventually(async () => !(await online()), 50_000);
  console.log("Stopped agent correctly expired to offline.");
  agent = spawn(executable, ["run"], {
    env: { ...process.env, LOCALAPPDATA: stateDirectory },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  agent.stdout?.resume();
  agent.stderr?.resume();
  const stopped = new Promise<number | null>((resolveExit, reject) => {
    agent!.once("exit", resolveExit);
    agent!.once("error", reject);
  });
  await eventually(online);
  const machine = await pool.query<{ id: string }>(
    "SELECT id FROM machines WHERE account_id=$1",
    [accountId],
  );
  const revoked = await fetch(
    `http://127.0.0.1:13010/api/machines/${machine.rows[0]!.id}/revoke`,
    { method: "POST", headers, body: "{}" },
  );
  assert.equal(revoked.status, 200);
  const status = await Promise.race([
    stopped,
    delay(20_000).then(() => {
      throw new Error("Revoked agent did not stop");
    }),
  ]);
  assert.notEqual(status, 0);
  assert.equal(await online(), false);
  console.log("Revoked identity was rejected and the native process stopped.");
} finally {
  agent?.kill();
  await app.close();
  await pool.query("DELETE FROM accounts WHERE id=$1", [accountId]);
  await pool.end();
  // mkdtemp generated this known test-only directory; never remove user state.
  assert.equal(dirname(resolve(stateDirectory)), resolve(tmpdir()));
  assert.match(basename(stateDirectory), /^beacon-remote-native-/);
  await rm(stateDirectory, { recursive: true, force: true });
}
