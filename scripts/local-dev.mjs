// Local control-plane supervisor. Stop requests address a run UUID, never a PID
// loaded from disk. Only child handles created by this process can be killed.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { open, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(root, ".remote-dev");
const lockPath = join(directory, "owner.json");
const database =
  "postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_dev";
const backendRequire = createRequire(join(root, "apps/backend/package.json"));
const webRequire = createRequire(join(root, "apps/web/package.json"));
const environment = {
  ...process.env,
  DATABASE_URL: database,
  WEB_ORIGIN: "http://127.0.0.1:5174",
  HOST: "127.0.0.1",
  PORT: "3010",
  NODE_ENV: "development",
  REMOTE_API_ORIGIN: "http://127.0.0.1:3010",
};
// A shell used for View or staging must not opt this launcher into media or
// production proxy trust. Media acceptance uses its separate explicit runner.
for (const key of [
  "SESSION_SECRET",
  "DEV_CONTROL_ENABLED",
  "REMOTE_DEV_CONTROL",
  "TURN_SECRET",
  "TURN_URLS",
  "STUN_URL",
  "ICE_TRANSPORT_POLICY",
  "TRUST_PROXY_CIDR",
  "NODE_OPTIONS",
  "NODE_ENV_OPTIONS",
])
  delete environment[key];

async function state() {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function vacant(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied; Remote will not reuse or stop its owner.`,
        ),
      ),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
async function command(executable, args, cwd = root) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      windowsHide: true,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Setup command exited ${code}`)),
    );
  });
}
async function setup() {
  await command("docker", [
    "compose",
    "-f",
    join(root, "infrastructure/compose.yaml"),
    "up",
    "-d",
    "--wait",
    "postgres",
  ]);
  for (const script of ["migrate", "verify-schema"])
    await command(process.execPath, [
      "--import",
      pathToFileURL(backendRequire.resolve("tsx")).href,
      join(root, `apps/backend/scripts/${script}.ts`),
    ]);
}
async function supervise(runId) {
  const lock = await open(lockPath, "wx").catch(() => {
    throw new Error(
      "Remote already has an owner file; use dev:status. Never stop an unrelated process or delete a live owner's file.",
    );
  });
  const owned = [];
  const logs = [];
  let stopped = false;
  const stopPath = join(directory, `stop-${runId}`);
  const record = {
    runId,
    supervisorPid: process.pid,
    root,
    startedAt: new Date().toISOString(),
    status: "starting",
    ports: { api: 3010, web: 5174, database: 5433 },
  };
  try {
    await lock.writeFile(JSON.stringify(record));
    await lock.close();
    await vacant(3010);
    await vacant(5174);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        stopped = true;
      });
    for (const [name, args] of [
      [
        "backend",
        [
          "--import",
          pathToFileURL(backendRequire.resolve("tsx")).href,
          join(root, "apps/backend/src/index.ts"),
        ],
      ],
      [
        "web",
        [join(dirname(webRequire.resolve("vite/package.json")), "bin/vite.js")],
      ],
    ]) {
      const output = await open(join(directory, `${name}.log`), "a");
      logs.push(output);
      const child = spawn(process.execPath, args, {
        cwd: join(root, `apps/${name}`),
        env: environment,
        windowsHide: true,
        stdio: ["ignore", output.fd, output.fd],
      });
      owned.push(child);
      child.once("error", () => {
        stopped = true;
      });
      child.once("exit", () => {
        stopped = true;
      });
    }
    const deadline = Date.now() + 30000;
    let ready = false;
    while (!stopped && Date.now() < deadline) {
      try {
        const replies = await Promise.all(
          [3010, 5174].map((port) =>
            fetch(`http://127.0.0.1:${port}/${port === 3010 ? "ready" : ""}`, {
              signal: AbortSignal.timeout(1000),
            }),
          ),
        );
        ready = replies.every((reply) => reply.ok);
        if (ready) break;
      } catch {
        /* Wait for our own listeners; never reuse pre-existing ones. */
      }
      await delay(250);
    }
    if (!ready || stopped)
      throw new Error(
        "Remote startup failed; inspect .remote-dev backend/web logs.",
      );
    record.status = "ready";
    await writeFile(lockPath, JSON.stringify(record));
    while (!stopped) {
      try {
        await readFile(stopPath);
        stopped = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await delay(250);
    }
  } finally {
    // These are our original ChildProcess handles, not PIDs recovered from state.
    for (const child of owned) if (child.exitCode === null) child.kill();
    await Promise.all(
      owned.map((child) =>
        child.exitCode !== null
          ? Promise.resolve()
          : Promise.race([
              new Promise((resolve) => child.once("exit", resolve)),
              delay(5000),
            ]),
      ),
    );
    await lock.close().catch(() => {});
    for (const log of logs) await log.close();
    if ((await state())?.runId === runId) await unlink(lockPath);
    await unlink(stopPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
async function start() {
  if (await state())
    throw new Error(
      "Remote owner state exists. Run dev:status and dev:stop; do not overwrite it.",
    );
  const runId = randomUUID();
  const output = await open(join(directory, "supervisor.log"), "a");
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "run", runId],
    {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output.fd, output.fd],
    },
  );
  child.unref();
  await output.close();
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    const current = await state();
    if (current?.runId === runId && current.status === "ready") {
      console.log(
        "Beacon Remote: http://127.0.0.1:5174 (API 3010, DB 5433). Media disabled. Logs: .remote-dev/",
      );
      return;
    }
    if (!alive(child.pid))
      throw new Error(
        "Remote startup failed. Inspect .remote-dev/supervisor.log; occupied ports are never reclaimed.",
      );
    await delay(250);
  }
  await writeFile(join(directory, `stop-${runId}`), "");
  throw new Error(
    "Remote startup timed out; its own supervisor was asked to stop.",
  );
}
async function stop() {
  const current = await state();
  if (!current) {
    console.log("Remote is not running under this launcher.");
    return;
  }
  if (current.root !== root || !/^[a-f0-9-]{36}$/.test(current.runId))
    throw new Error("Invalid owner state; no stop issued.");
  if (!alive(current.supervisorPid))
    throw new Error(
      "Stale Remote owner file; inspect it and archive only that file after confirming no Remote listeners remain. No PID was killed.",
    );
  await writeFile(join(directory, `stop-${current.runId}`), "");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if ((await state())?.runId !== current.runId) {
      console.log(
        "Stopped this launcher's Remote processes. PostgreSQL and View were preserved.",
      );
      return;
    }
    await delay(250);
  }
  throw new Error(
    "Remote stop was requested but not confirmed; inspect logs. No external PID was killed.",
  );
}
await mkdir(directory, { recursive: true });
try {
  switch (process.argv[2]) {
    case "setup":
      await setup();
      break;
    case "start":
      await start();
      break;
    case "run":
      await supervise(process.argv[3]);
      break;
    case "stop":
      await stop();
      break;
    case "status": {
      const current = await state();
      console.log(
        current
          ? { ...current, supervisorAlive: alive(current.supervisorPid) }
          : "Remote launcher stopped",
      );
      break;
    }
    default:
      throw new Error(
        "Usage: node scripts/local-dev.mjs setup|start|stop|status",
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
