import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptanceOrigin,
  inspectAcceptance,
} from "./acceptance-readiness.mjs";

const result = await inspectAcceptance();
console.log(`Acceptance backend: ${result.ready ? "ready" : "unavailable"}`);
console.log(`Origin: ${acceptanceOrigin}`);
for (const { path, status, expected } of result.probes)
  console.log(`${path}: ${status ?? "unreachable"} (expected ${expected})`);
const state =
  process.env.REMOTE_ACCEPTANCE_STATE_DIR ??
  join(
    process.env.BEACON_PRIVATE_DIR ??
      join(
        dirname(dirname(fileURLToPath(import.meta.url))),
        "../../Beacon-Secrets",
      ),
    "remote/acceptance/android",
  );
for (const [name, label] of [
  ["STOP", "Fixture STOP marker"],
  ["BeaconRemote/identity.dpapi", "Retained isolated identity"],
]) {
  try {
    await access(join(state, name));
    console.log(`${label}: present`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.log(`${label}: absent`);
  }
}
if (process.argv.includes("--adb")) {
  const adb =
    process.env.REMOTE_ACCEPTANCE_ADB_PATH ??
    (process.env.ANDROID_HOME
      ? join(
          process.env.ANDROID_HOME,
          "platform-tools",
          process.platform === "win32" ? "adb.exe" : "adb",
        )
      : "adb");
  try {
    const { stdout } = await promisify(execFile)(adb, ["devices", "-l"], {
      timeout: 10000,
      windowsHide: true,
    });
    console.log(stdout.trim());
  } catch {
    console.log(
      "ADB inventory unavailable. Set REMOTE_ACCEPTANCE_ADB_PATH to the platform-tools executable.",
    );
    process.exitCode = 1;
  }
}
console.log(
  "Read-only status; no login, restart, device input or Windows consent action performed.",
);
if (!result.ready) process.exitCode = 1;
