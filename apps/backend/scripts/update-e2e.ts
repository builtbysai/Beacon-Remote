// Real-process check of signed host updates (ADR 0028) on this Windows machine, no browser.
// A local server pairs the OLD build's agent and serves a signed feed for the NEW build; the real agent
// then checks, downloads, verifies and installs it over itself, and the old files are kept.
//   UPDATE_E2E_OLD=<dir of the old package, extracted>  UPDATE_E2E_FEED=<dir written by publish-download.mjs>
// The updater restarts the host window when it finishes; this script closes it.
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

if (process.platform !== "win32") throw new Error("Windows required");
const oldSource = process.env.UPDATE_E2E_OLD;
const feed = process.env.UPDATE_E2E_FEED;
if (!oldSource || !feed)
  throw new Error("Set UPDATE_E2E_OLD and UPDATE_E2E_FEED");
const root = resolve(import.meta.dirname, "../../..");
const work = resolve(root, `.remote-dev/update-e2e/${randomUUID()}`);
const install = resolve(work, "install");
const profile = resolve(work, "profile");
const database =
  "postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test";
const port = 13014;
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env, LOCALAPPDATA: profile };
const pass = (message: string) => console.log(`PASS ${message}`);
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL ${message}`);
  pass(message);
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const agent = () => resolve(install, "beacon-remote-agent.exe");

function run(args: string[], input?: string): Promise<string> {
  return new Promise((done, reject) => {
    const child = spawn(agent(), args, {
      env,
      windowsHide: true,
      cwd: install,
    });
    let out = "";
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (out += data));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done(out)
        : reject(new Error(`agent ${args.join(" ")} exited ${code}: ${out}`)),
    );
    child.stdin.end(input ?? "");
  });
}
const installedCommit = async () =>
  JSON.parse(
    (await readFile(resolve(install, "manifest.json"), "utf8")).replace(
      /^\uFEFF/,
      "",
    ),
  ).commit as string;

const admin = new Pool({ connectionString: database });
const schema = `update_e2e_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: database,
  options: `-c search_path=${schema}`,
});
let app: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  await mkdir(profile, { recursive: true });
  await cp(oldSource, install, { recursive: true });
  const before = await installedCommit();

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
  });
  // The real deployment serves these files from its web container; here the test server does.
  let served = feed;
  app.get("/downloads/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!/^[A-Za-z0-9._-]+$/.test(file) || !existsSync(resolve(served, file)))
      return reply.code(404).send({ error: "Not found" });
    return reply
      .type("application/octet-stream")
      .send(await readFile(resolve(served, file)));
  });
  await app.listen({ host: "127.0.0.1", port });
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email, password },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const enrollment = await app.inject({
    method: "POST",
    url: "/api/enrollments",
    headers: { origin, cookie },
    payload: {},
  });
  await run(
    ["pair"],
    `${origin}\nUpdate e2e computer\n${enrollment.json().code}\n`,
  );
  pass("the old build paired with its own identity");

  const found = await run(["update", "check"]);
  check(
    /Update available: development-/.test(found),
    "the old build finds the signed update",
  );

  // A feed whose signature does not match is refused, and nothing is installed.
  const tampered = resolve(work, "tampered");
  await cp(feed, tampered, { recursive: true });
  const manifestPath = resolve(tampered, "manifest.json");
  const changed = (await readFile(manifestPath, "utf8")).replace(
    '"bytes": ',
    '"bytes": 1',
  );
  await rm(manifestPath);
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(manifestPath, changed),
  );
  served = tampered;
  let refused = false;
  try {
    await run(["update", "check"]);
  } catch (error) {
    refused = /not signed by the Beacon Remote update key/.test(String(error));
  }
  check(refused, "a feed that does not match its signature is refused");
  served = feed;

  await run(["update", "install"]);
  let updated = false;
  for (let waited = 0; waited < 40_000 && !updated; waited += 500) {
    updated =
      (await installedCommit()) !== before &&
      existsSync(resolve(install, "installed.json"));
    if (!updated) await sleep(500);
  }
  check(updated, "the update replaced the installed program");
  check(
    !existsSync(resolve(install, "update.log")),
    "the updater reported no failure",
  );
  const kept = JSON.parse(
    (
      await readFile(resolve(install, "previous/manifest.json"), "utf8")
    ).replace(/^\uFEFF/, ""),
  );
  check(kept.commit === before, "the previous version is kept for rollback");
  check(
    (await run(["update", "check"])).includes("Already up to date"),
    "the updated build sees no further update",
  );
  console.log("Signed update end to end: all checks passed.");
} finally {
  // The updater restarts the host window; close it before cleaning up.
  await new Promise<void>((done) => {
    const kill = spawn("taskkill", ["/IM", "beacon-remote-host.exe", "/F"], {
      windowsHide: true,
    });
    kill.once("exit", () => done());
    kill.once("error", () => done());
  });
  await sleep(1500);
  await app?.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  await rm(work, { recursive: true, force: true });
}
