// Isolated, loopback-only acceptance fixture. Never uses a production identity.
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { hostname } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { createServer } from "../../web/node_modules/vite/dist/node/index.js";
import { createApp } from "../src/app.js";
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

if (process.env.REMOTE_DEV_CONTROL !== "true")
  throw new Error("Set REMOTE_DEV_CONTROL=true for this development fixture");
if (process.platform !== "win32")
  throw new Error("Windows interactive session required");
const root = resolve(import.meta.dirname, "../../..");
const database =
  "postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test";
const admin = new Pool({ connectionString: database });
const schema = `input_dev_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: database,
  options: `-c search_path=${schema}`,
});
const origin = "http://127.0.0.1:5175";
const server = "http://127.0.0.1:3011";
const account = randomUUID();
const email = `input-${account}@example.test`;
const password = randomBytes(32).toString("base64url");
const state = resolve(root, ".remote-dev/input-development");
const keys = generateKeyPairSync("ed25519");
let helper: ChildProcess | undefined;
let web: Awaited<ReturnType<typeof createServer>> | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
let ending = false;
async function stop() {
  if (ending) return;
  ending = true;
  clearInterval(tick);
  // Signal Stop via backend first, allowing held-input cleanup before process exit.
  await app?.close();
  if (helper && helper.exitCode === null) {
    await Promise.race([
      new Promise<void>((done) => helper!.once("exit", () => done())),
      new Promise<void>((done) => setTimeout(done, 5000)),
    ]);
    if (helper.exitCode === null) helper.kill();
  }
  await web?.close();
  await pool.end();
  // Dedicated disposable fixture schema only; identifiers are locally generated.
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  for (const file of [
    "001_identity.sql",
    "002_view_sessions.sql",
    "003_control_scope.sql",
  ])
    await pool.query(
      await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
    );
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [account, email, await hash(password)],
  );
  const loginToken = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '30 minutes')",
    [createHash("sha256").update(loginToken).digest("hex"), account],
  );
  app = await createApp(pool, {
    DATABASE_URL: database,
    WEB_ORIGIN: origin,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: 3011,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    DEV_CONTROL_ENABLED: "true",
    STUN_URL: "stun:stun.l.google.com:19302",
  });
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/enrollments",
    headers: { origin, cookie: `remote_session=${loginToken}` },
    payload: {},
  });
  if (enrollment.statusCode !== 200)
    throw new Error("Development enrollment failed");
  const enrolled = await app.inject({
    method: "POST",
    url: "/api/agent/enroll",
    payload: {
      version: 1,
      code: enrollment.json().code,
      name: `${hostname()} · Input development`,
      publicKey: keys.publicKey
        .export({ type: "spki", format: "der" })
        .subarray(-32)
        .toString("base64"),
    },
  });
  if (enrolled.statusCode !== 200)
    throw new Error("Development pairing failed");
  const machineId = enrolled.json().machineId as string;
  await app.listen({ host: "127.0.0.1", port: 3011 });
  process.env.REMOTE_API_ORIGIN = server;
  web = await createServer({
    root: resolve(root, "apps/web"),
    configFile: resolve(root, "apps/web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 5175, strictPort: true },
  });
  await web.listen();
  await mkdir(state, { recursive: true });
  await writeFile(
    resolve(state, "login.json"),
    JSON.stringify({ origin, email, password }),
  );
  console.log(
    "Isolated input development: http://127.0.0.1:5175 — login in .remote-dev/input-development/login.json. Local Windows approval remains mandatory. Ends after 30 minutes.",
  );
  const handled = new Set<string>();
  let polling = false;
  async function heartbeat() {
    if (polling || ending || !app) return;
    polling = true;
    try {
      if (
        await access(resolve(state, "STOP")).then(
          () => true,
          () => false,
        )
      ) {
        await stop();
        return;
      }
      const timestamp = Date.now(),
        nonce = randomUUID();
      const response = await app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          version: 1,
          machineId,
          timestamp,
          nonce,
          signature: sign(
            null,
            Buffer.from(heartbeatMessage(machineId, timestamp, nonce)),
            keys.privateKey,
          ).toString("base64"),
        },
      });
      if (response.statusCode !== 200)
        throw new Error("Development heartbeat rejected");
      for (const grant of response.json().sessions ?? []) {
        if (handled.has(grant.id) || (helper && helper.exitCode === null))
          continue;
        handled.add(grant.id);
        helper = spawn(
          resolve(root, "target/release/beacon-remote-session.exe"),
          ["media-test"],
          {
            env: { ...process.env, REMOTE_DEV_CONTROL: "true" },
            stdio: ["pipe", "inherit", "inherit"],
          },
        );
        helper.once("error", () => {
          console.error("Matching native helper unavailable");
          void stop();
        });
        helper.stdin!.end(JSON.stringify({ ...grant, server }));
      }
    } catch {
      console.error(
        "Development fixture stopped after a host boundary failure",
      );
      await stop();
    } finally {
      polling = false;
    }
  }
  await heartbeat();
  tick = setInterval(() => void heartbeat(), 1000);
  setTimeout(() => void stop(), 30 * 60_000).unref();
} catch (error) {
  await stop();
  throw error;
}
