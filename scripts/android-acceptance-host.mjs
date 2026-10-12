import assert from "node:assert/strict";
import { readFile, access, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAcceptanceReady } from "./acceptance-readiness.mjs";
const state =
  process.env.REMOTE_ACCEPTANCE_STATE_DIR ??
  join(homedir(), ".beacon-remote-recovery", "android-acceptance-20261010");
const origin = "https://remote-test.builtbysai.com";
const executable =
  process.env.REMOTE_ACCEPTANCE_AGENT_PATH ??
  join(
    dirname(dirname(fileURLToPath(import.meta.url))),
    ".agent-state",
    "android-acceptance-0979cd1",
    "beacon-remote-agent.exe",
  );
let stopMarkerPresent = false;
try {
  await access(join(state, "STOP"));
  stopMarkerPresent = true;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
assert.equal(
  stopMarkerPresent,
  false,
  "Fixture is stopped. Deliberately remove its STOP marker before restarting acceptance.",
);
await requireAcceptanceReady();
let alreadyPaired = false;
try {
  await access(`${state}/BeaconRemote/identity.dpapi`);
  alreadyPaired = true;
} catch {
  // No isolated identity yet; enrollment below creates it.
}
if (!alreadyPaired) {
  const login = JSON.parse(await readFile(`${state}/login.json`, "utf8"));
  const response = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(login),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, "Acceptance sign-in failed");
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("remote_session="))
    .split(";")[0];
  const enrollment = await fetch(`${origin}/api/enrollments`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(enrollment.status, 200, "Acceptance enrollment failed");
  const pair = spawn(executable, ["pair"], {
    env: { ...process.env, LOCALAPPDATA: state },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  pair.stdout.resume();
  pair.stderr.resume();
  const paired = new Promise((resolve, reject) => {
    pair.once("error", reject);
    pair.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Acceptance native pairing failed")),
    );
  });
  pair.stdin.end(
    `${origin}\nWindows test PC\n${(await enrollment.json()).code}\n`,
  );
  await paired;
  login.password = null;
}
const agent = spawn(executable, ["run"], {
  env: { ...process.env, LOCALAPPDATA: state },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const log = [];
agent.stdout.on("data", (data) => {
  const text = data.toString();
  log.push(text);
  process.stdout.write(text);
});
agent.stderr.on("data", (data) => {
  const text = data.toString();
  log.push(text);
  process.stderr.write(text);
});
let stopped = false;
process.stdin.on("data", (data) => {
  if (data.toString().includes("STOP")) stopped = true;
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    stopped = true;
  });
agent.once("exit", () => {
  stopped = true;
});
agent.once("error", () => {
  stopped = true;
});
console.log(
  "Windows test PC using isolated HTTPS acceptance identity. Awaiting user request. No desktop capture started.",
);
try {
  const deadline = Date.now() + 45 * 60 * 1000;
  while (!stopped && Date.now() < deadline) {
    try {
      await access(`${state}/STOP`);
      stopped = true;
    } catch {
      // Missing STOP marker means the bounded fixture can continue.
    }
    await delay(500);
  }
} finally {
  agent.kill();
  await writeFile(`${state}/native-status.log`, log.join(""));
  console.log(
    "Acceptance agent stopped. Isolated identity retained for test cleanup.",
  );
}
