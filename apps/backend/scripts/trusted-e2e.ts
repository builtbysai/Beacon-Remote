// Real-process check of trusted personal access (ADR 0021) on this Windows machine, with no browser:
// pair a disposable agent, turn trusted access on from the computer, request a session as the
// signed-in owner, and confirm that nothing waits for a local Allow, that the session outlives the old
// two-minute limit, that a dropped viewer resumes, and that lowering the policy ends the session.
// It starts the real helper, so the visible sharing indicator appears on this desktop while it runs.
// Build first: cargo build --release
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import WebSocket from "ws";
import { hash } from "@node-rs/argon2";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

if (process.platform !== "win32") throw new Error("Windows required");
const root = resolve(import.meta.dirname, "../../..");
const profile = resolve(
  root,
  `.remote-dev/trusted-e2e/profile-${randomUUID()}`,
);
const database =
  "postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test";
const port = 13012;
const origin = `http://127.0.0.1:${port}`;
const holdSeconds = Number(process.env.E2E_HOLD_SECONDS ?? 150);
const bin = (name: string) => resolve(root, `target/release/${name}.exe`);
const env = { ...process.env, LOCALAPPDATA: profile };
const pass = (message: string) => console.log(`PASS ${message}`);
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL ${message}`);
  pass(message);
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function run(exe: string, args: string[], input?: string): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(bin(exe), args, { env, windowsHide: true });
    let out = "";
    child.stdout.on("data", (data) => (out += data));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done(out)
        : reject(new Error(`${exe} ${args.join(" ")} exited ${code}: ${out}`)),
    );
    child.stdin.end(input ?? "");
  });
}

const admin = new Pool({ connectionString: database });
const schema = `trusted_e2e_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: database,
  options: `-c search_path=${schema}`,
});
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let agent: ChildProcess | undefined;
const sockets: WebSocket[] = [];
try {
  await applyMigrations(pool);
  const account = randomUUID();
  const email = `${account}@example.test`;
  const password = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [account, email, await hash(password)],
  );
  app = await createApp(pool, {
    DATABASE_URL: database,
    WEB_ORIGIN: origin,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: port,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    CONTROL_ENABLED: "true",
  });
  await app.listen({ host: "127.0.0.1", port });
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const headers = { origin, cookie };
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/enrollments",
    headers,
    payload: {},
  });
  await mkdir(profile, { recursive: true });
  await run(
    "beacon-remote-agent",
    ["pair"],
    `${origin}\nTrusted e2e computer\n${enrollment.json().code}\n`,
  );
  const machineId = (
    await pool.query("SELECT id FROM machines WHERE account_id=$1", [account])
  ).rows[0].id as string;
  pass("the computer paired with its own identity");

  check(
    (await run("beacon-remote-agent", ["access", "status"])).trim() ===
      "attended",
    "a new computer is attended by default",
  );
  await run("beacon-remote-agent", ["access", "trusted"]);
  check(
    (await run("beacon-remote-agent", ["access", "status"])).includes(
      "trusted, viewing only",
    ),
    "trusted access is raised from the computer itself",
  );
  check(
    (
      await pool.query(
        "SELECT mode,allow_control FROM machine_access WHERE machine_id=$1",
        [machineId],
      )
    ).rows[0].mode === "trusted",
    "the server recorded the signed policy",
  );

  agent = spawn(bin("beacon-remote-agent"), ["run"], {
    env,
    windowsHide: true,
    // E2E_AGENT_LOG=<file> keeps the agent's and helper's output for debugging a failure.
    stdio: process.env.E2E_AGENT_LOG
      ? [
          "ignore",
          openSync(process.env.E2E_AGENT_LOG, "w"),
          openSync(process.env.E2E_AGENT_LOG, "a"),
        ]
      : "ignore",
  });
  for (let waited = 0; waited < 15_000; waited += 250) {
    const seen = await pool.query(
      "SELECT 1 FROM machines WHERE id=$1 AND last_seen_at>now()-interval '20 seconds'",
      [machineId],
    );
    if (seen.rowCount) break;
    await sleep(250);
  }
  pass("the agent reports presence");
  const reported = (
    await pool.query("SELECT displays FROM machines WHERE id=$1", [machineId])
  ).rows[0].displays as { id: string; primary: boolean }[];
  check(
    reported.some((display) => display.primary),
    `the agent reports its displays (${reported.map((display) => display.id).join(", ")})`,
  );

  const created = await app.inject({
    method: "POST",
    url: `/api/machines/${machineId}/sessions`,
    headers,
    payload: {
      source: "desktop",
      capability: "desktop:view",
      displayId: reported.find(
        (display) => display.primary !== Boolean(process.env.E2E_SECONDARY),
      )!.id,
    },
  });
  check(created.statusCode === 200, "the owner requests a session");
  const sessionId = created.json().id as string;
  const approval = (
    await pool.query("SELECT approval FROM view_sessions WHERE id=$1", [
      sessionId,
    ])
  ).rows[0].approval;
  check(
    approval === "policy",
    "the server approved it by the computer's own policy",
  );

  const connect = (generation: string) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/sessions/${sessionId}/signal?role=viewer`,
      { headers },
    );
    sockets.push(socket);
    const seen: { type: string; generation?: number }[] = [];
    socket.on("message", (data) => seen.push(JSON.parse(data.toString())));
    return { socket, seen, generation };
  };
  const waitFor = async (
    seen: { type: string }[],
    type: string,
    ms: number,
  ) => {
    for (let waited = 0; waited < ms; waited += 100) {
      if (seen.some((message) => message.type === type)) return true;
      await sleep(100);
    }
    return false;
  };
  const first = connect("0");
  const started = Date.now();
  check(
    await waitFor(first.seen, "consent", 20_000),
    "consent arrived with no one clicking Allow",
  );
  check(
    Date.now() - started < 20_000,
    `...within ${Math.round((Date.now() - started) / 1000)} s`,
  );
  check(
    await waitFor(first.seen, "offer", 20_000),
    "the helper began a desktop media session",
  );
  const status = async () =>
    (
      await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
        sessionId,
      ])
    ).rows[0].status as string;
  check((await status()) === "active", "the session is active");

  console.log(
    `Holding the session for ${holdSeconds} s (the old limit was 120 s)…`,
  );
  await sleep(holdSeconds * 1000);
  check(
    (await status()) === "active" && first.socket.readyState === WebSocket.OPEN,
    `the session is still active after ${holdSeconds} s`,
  );

  first.socket.terminate();
  await sleep(1500);
  const resumed = await app.inject({
    method: "POST",
    url: `/api/sessions/${sessionId}/resume`,
    headers,
    payload: {},
  });
  check(
    resumed.statusCode === 200,
    "a dropped viewer resumes the same session",
  );
  const second = connect("1");
  check(
    await waitFor(second.seen, "consent", 15_000),
    "the resumed viewer is accepted without a new prompt",
  );
  check(
    await waitFor(second.seen, "offer", 25_000),
    "a fresh media session was offered after the drop",
  );
  check((await status()) === "active", "the session survived the outage");

  const lowered = await app.inject({
    method: "POST",
    url: `/api/machines/${machineId}/access`,
    headers,
    payload: { mode: "attended" },
  });
  check(
    lowered.statusCode === 200 && lowered.json().changed === true,
    "the owner lowers the computer's access from the web",
  );
  let ended = false;
  for (let waited = 0; waited < 15_000 && !ended; waited += 250) {
    ended =
      second.socket.readyState === WebSocket.CLOSED ||
      (await status()) !== "active";
    if (!ended) await sleep(250);
  }
  check(ended, "the session ended within seconds of lowering access");
  check(
    (await status()) !== "active",
    `...and is recorded as ${await status()}`,
  );

  // Attended support: the computer issues a one-time code and a different signed-in account
  // redeems it. The session still waits for the local Allow, which no script clicks.
  const support = (await run("beacon-remote-agent", ["support", "view"])).match(
    /Support code: ([A-Z2-9]{4}-[A-Z2-9]{4})/,
  );
  check(Boolean(support), "the computer issues a one-time support code");
  const helperId = randomUUID();
  const helperEmail = `${helperId}@example.test`;
  const helperPassword = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [helperId, helperEmail, await hash(helperPassword)],
  );
  const helperLogin = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email: helperEmail, password: helperPassword },
  });
  const helperHeaders = {
    origin,
    cookie: String(helperLogin.headers["set-cookie"]).split(";")[0]!,
  };
  const claimed = await app.inject({
    method: "POST",
    url: "/api/support/claim",
    headers: helperHeaders,
    payload: { code: support![1] },
  });
  check(
    claimed.statusCode === 200 && claimed.json().approval === "local",
    "the helper redeems it and the session waits for the local Allow",
  );
  const repeat = await app.inject({
    method: "POST",
    url: "/api/support/claim",
    headers: helperHeaders,
    payload: { code: support![1] },
  });
  check(repeat.statusCode === 404, "the same code works only once");
  await app.inject({
    method: "POST",
    url: `/api/sessions/${claimed.json().id}/stop`,
    headers: helperHeaders,
  });

  // A remembered helper skips the Allow only when this computer says so, and lowering ends it.
  const shared = await app.inject({
    method: "POST",
    url: `/api/machines/${machineId}/relationships`,
    headers,
    payload: { email: helperEmail, capability: "desktop:view", days: 1 },
  });
  check(shared.statusCode === 200, "the owner remembers the helper");
  const asked = await app.inject({
    method: "POST",
    url: `/api/relationships/${shared.json().id}/sessions`,
    headers: helperHeaders,
    payload: {},
  });
  check(
    asked.json().approval === "local",
    "before the computer agrees, the Allow is still needed",
  );
  await app.inject({
    method: "POST",
    url: `/api/sessions/${asked.json().id}/stop`,
    headers: helperHeaders,
  });
  await run("beacon-remote-agent", ["helpers", "view"]);
  pass("the computer lets remembered helpers view without asking");
  const unattended = await app.inject({
    method: "POST",
    url: `/api/relationships/${shared.json().id}/sessions`,
    headers: helperHeaders,
    payload: {},
  });
  check(
    unattended.json().approval === "policy",
    "the server approves the helper by the computer's policy",
  );
  const helperSocket = new WebSocket(
    `ws://127.0.0.1:${port}/api/sessions/${unattended.json().id}/signal?role=viewer`,
    { headers: helperHeaders },
  );
  sockets.push(helperSocket);
  const helperSeen: { type: string }[] = [];
  helperSocket.on("message", (data) =>
    helperSeen.push(JSON.parse(data.toString())),
  );
  check(
    await waitFor(helperSeen, "consent", 25_000),
    "the helper connects with no one clicking Allow",
  );
  check(
    await waitFor(helperSeen, "offer", 25_000),
    "and the helper receives the media offer",
  );
  await app.inject({
    method: "POST",
    url: `/api/machines/${machineId}/access`,
    headers,
    payload: { helpers: "off" },
  });
  let helperEnded = false;
  for (let waited = 0; waited < 15_000 && !helperEnded; waited += 250) {
    helperEnded =
      helperSocket.readyState === WebSocket.CLOSED ||
      (
        await pool.query("SELECT status FROM view_sessions WHERE id=$1", [
          unattended.json().id,
        ])
      ).rows[0].status !== "active";
    if (!helperEnded) await sleep(250);
  }
  check(
    helperEnded,
    "lowering remembered helpers ends the helper's session within seconds",
  );
  console.log("Trusted access end to end: all checks passed.");
} finally {
  for (const socket of sockets) socket.terminate();
  agent?.kill();
  await sleep(1500);
  await app?.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
