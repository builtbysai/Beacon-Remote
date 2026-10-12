// Native GUI acceptance with real enrollment/presence and disposable user state.
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { createApp } from "../src/app.js";

if (process.platform !== "win32") throw new Error("Windows required");
const root = resolve(import.meta.dirname, "../../..");
const state = resolve(root, ".remote-dev/host-development");
const profile = resolve(state, `profile-${randomUUID()}`);
const database =
  "postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test";
const admin = new Pool({ connectionString: database });
const schema = `host_dev_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: database,
  options: `-c search_path=${schema}`,
});
let app: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  for (const migration of [
    "001_identity.sql",
    "002_view_sessions.sql",
    "003_control_scope.sql",
    "004_development_session_duration.sql",
  ])
    await pool.query(
      await readFile(
        new URL(`../migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  const account = randomUUID();
  const email = `${account}@example.test`;
  const password = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [account, email, await hash(password)],
  );
  const origin = "http://127.0.0.1:13011";
  app = await createApp(pool, {
    DATABASE_URL: database,
    WEB_ORIGIN: origin,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 13011,
  });
  await app.listen({ host: "127.0.0.1", port: 13011 });
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  if (login.statusCode !== 200) throw new Error("Fixture login failed");
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/enrollments",
    headers: { origin, cookie },
    payload: {},
  });
  if (enrollment.statusCode !== 200)
    throw new Error("Fixture enrollment failed");
  await mkdir(profile, { recursive: true });
  const paired = spawn(
    resolve(root, "target/release/beacon-remote-agent.exe"),
    ["pair"],
    {
      env: { ...process.env, LOCALAPPDATA: profile },
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  const pairing = new Promise<void>((done, reject) => {
    paired.once("error", reject);
    paired.once("exit", (code) =>
      code === 0 ? done() : reject(new Error("Actual native pairing failed")),
    );
  });
  paired.stdin!.end(
    `${origin}\nWindows host acceptance\n${enrollment.json().code}\n`,
  );
  await pairing;
  const host = spawn(
    resolve(root, "target/release/beacon-remote-host.exe"),
    [],
    {
      env: { ...process.env, LOCALAPPDATA: profile },
      stdio: "ignore",
    },
  );
  const finished = new Promise<void>((done, reject) => {
    host.once("error", reject);
    host.once("exit", () => done());
  });
  await writeFile(
    resolve(state, "fixture.json"),
    JSON.stringify({ profile, server: origin, pid: host.pid }),
  );
  console.log(
    "Isolated native host window opened. Start/Stop/tray operate real signed presence; close the window to finish. No desktop media is enabled.",
  );
  const poll = setInterval(() => {
    void (async () => {
      const result = await pool.query(
        "SELECT id,last_seen_at,revoked_at FROM machines WHERE account_id=$1",
        [account],
      );
      await writeFile(
        resolve(state, "presence.json"),
        JSON.stringify(result.rows),
      );
      // Revocation acceptance is explicit and confined to this disposable identity.
      if (
        await access(resolve(state, "REVOKE")).then(
          () => true,
          () => false,
        )
      )
        await pool.query(
          "UPDATE machines SET revoked_at=now() WHERE account_id=$1",
          [account],
        );
    })().catch(() => {});
  }, 1000);
  try {
    await finished;
  } finally {
    clearInterval(poll);
  }
} finally {
  await app?.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
