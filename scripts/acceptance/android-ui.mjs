// Explicitly owned emulator only. No physical-device discovery or production API.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { createPublicKey, verify, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const exec = promisify(execFile),
  root = resolve(import.meta.dirname, "../..");
if (!process.env.REMOTE_DEV_STATE_DIR)
  throw Error("Enter the Remote workspace first");
const output = join(process.env.REMOTE_DEV_STATE_DIR, "android-ui-2026-11-16");
await mkdir(output, { recursive: true });
const serial = "emulator-5580",
  expectedAvd = "BeaconRemote_UI_20261115";
const adbPath = join(
  process.env.LOCALAPPDATA,
  "Android/Sdk/platform-tools/adb.exe",
);
const adb = (args, timeout = 30_000) =>
  exec(adbPath, ["-s", serial, ...args], {
    windowsHide: true,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
const avd = (await adb(["emu", "avd", "name"])).stdout
  .replaceAll("\r", "")
  .split("\n")
  .filter(Boolean)[0];
assert.equal(
  avd,
  expectedAvd,
  "Refuse an emulator not created for this UI pass",
);
assert.ok(
  ["ranchu", "goldfish"].includes(
    (await adb(["shell", "getprop", "ro.hardware"])).stdout.trim(),
  ),
);
assert.equal(
  (await adb(["shell", "getprop", "ro.kernel.qemu"])).stdout.trim(),
  "1",
);
assert.equal(
  (await adb(["shell", "getprop", "sys.boot_completed"])).stdout.trim(),
  "1",
);
const machine = randomUUID();
let enrollmentReply,
  publicKey,
  enrollments = 0,
  enables = 0,
  disables = 0,
  declines = 0,
  mode = "attended",
  staleHeartbeat = false,
  staleHeartbeats = 0,
  heartbeats = 0;
const sockets = new WebSocketServer({ noServer: true });
const failures = [];
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/fixture/release-enrollment") {
    assert.ok(enrollmentReply);
    const reply = enrollmentReply;
    enrollmentReply = undefined;
    setTimeout(() => reply.end(JSON.stringify({ machineId: machine })), 100);
    res.end("{}");
    return;
  }
  if (req.url === "/fixture/stale-heartbeat") {
    staleHeartbeat = true;
    res.end("{}");
    return;
  }
  if (req.url === "/fixture/state") {
    res.end(
      JSON.stringify({
        enables,
        disables,
        enrollments,
        declines,
        staleHeartbeats,
        heartbeats,
      }),
    );
    return;
  }
  let raw = "";
  req.on("data", (part) => (raw += part));
  req.on("end", () => {
    try {
      const body = JSON.parse(raw || "{}");
      const path = req.url.split("?")[0];
      if (path === "/api/agent/enroll") {
        assert.equal(body.name, "Synthetic Android device with a long name");
        assert.equal(body.code, "aB3_dE6-gH9_jK2-mN5_pQ8-rS1_tU4v");
        publicKey = createPublicKey({
          format: "der",
          type: "spki",
          key: Buffer.concat([
            Buffer.from("302a300506032b6570032100", "hex"),
            Buffer.from(body.publicKey, "base64"),
          ]),
        });
        enrollments++;
        enrollmentReply = res;
        return;
      }
      if (!["/api/agent/access", "/api/agent/heartbeat"].includes(path)) {
        res.statusCode = 404;
        res.end("{}");
        return;
      }
      assert.equal(body.machineId, machine);
      if (path === "/api/agent/access") {
        const message = `beacon-remote:access:v1\n${machine}\n${body.timestamp}\n${body.nonce}\n${body.mode}\n${body.allowControl}`;
        assert.ok(
          verify(
            null,
            Buffer.from(message),
            publicKey,
            Buffer.from(body.signature, "base64"),
          ),
        );
        mode = body.mode;
        if (mode === "trusted") enables++;
        else disables++;
        setTimeout(
          () => res.end('{"ok":true}'),
          mode === "trusted" ? 2500 : 100,
        );
        return;
      }
      if (path === "/api/agent/heartbeat") {
        assert.ok(
          verify(
            null,
            Buffer.from(
              `beacon-remote:heartbeat:v1\n${machine}\n${body.timestamp}\n${body.nonce}`,
            ),
            publicKey,
            Buffer.from(body.signature, "base64"),
          ),
        );
        heartbeats++;
        if (staleHeartbeat) {
          staleHeartbeat = false;
          staleHeartbeats++;
          setTimeout(() => {
            res.statusCode = 401;
            res.end("{}");
          }, 2500);
          return;
        }
        setTimeout(
          () =>
            res.end(
              JSON.stringify({
                access: { mode, allowControl: mode === "trusted" },
                sessions: [],
              }),
            ),
          250,
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    } catch {
      failures.push("Unexpected fixture request or invalid signature");
      res.statusCode = 400;
      res.end("{}");
    }
  });
});
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://fixture.invalid");
  if (
    !/^\/api\/sessions\/[a-f0-9-]{36}\/signal$/.test(url.pathname) ||
    url.searchParams.get("role") !== "machine" ||
    req.headers.authorization !== "Bearer synthetic-not-a-real-grant"
  ) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (peer) =>
    sockets.emit("connection", peer),
  );
});
sockets.on("connection", (peer) =>
  peer.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      assert.equal(message.type, "consent");
      assert.equal(message.accepted, false);
      declines++;
      peer.close();
    } catch {
      failures.push("Unexpected consent reply");
      peer.close();
    }
  }),
);
let installed = false;
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await adb([
    "install",
    "-r",
    join(root, "apps/android-host/app/build/outputs/apk/debug/app-debug.apk"),
  ]);
  installed = true;
  await adb([
    "install",
    "-r",
    join(
      root,
      "apps/android-host/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
    ),
  ]);
  await adb([
    "shell",
    "pm",
    "grant",
    "com.beaconremote.host",
    "android.permission.POST_NOTIFICATIONS",
  ]);
  const response = await adb(
    [
      "shell",
      "am",
      "instrument",
      "-w",
      "-r",
      "-e",
      "server",
      `http://10.0.2.2:${server.address().port}`,
      "com.beaconremote.host.test/com.beaconremote.host.UiLayoutAcceptance",
    ],
    300_000,
  );
  await writeFile(
    join(output, "instrumentation.log"),
    response.stdout + response.stderr,
  );
  await adb([
    "pull",
    "/sdcard/Android/data/com.beaconremote.host/files/ui",
    output,
  ]).catch(() => {});
  assert.match(response.stdout, /PASS: real native/);
  assert.match(response.stdout, /INSTRUMENTATION_CODE: -1/);
  assert.equal(enrollments, 1);
  assert.equal(enables, 1);
  assert.ok(disables > 0);
  assert.equal(declines, 3);
  assert.equal(staleHeartbeats, 1);
  assert.deepEqual(failures, []);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        scope:
          "fresh owned emulator, dummy loopback API; no real account/device/capture/input",
        setupAndApproval: true,
        mixedCasePairing: true,
        queuedCompletion: true,
        lateEnableRejected: true,
        stalePresenceRejected: true,
        policySignatures: true,
        configurationDeadline: true,
        duplicateDelivery: true,
        replacedApproval: true,
        expiredApproval: true,
        lightDark: true,
        largeText: true,
        enrollments,
        enables,
        disables,
      },
      null,
      2,
    ),
  );
  console.log(`Android UI emulator review passed: ${output}`);
} finally {
  if (installed)
    await adb(["shell", "am", "force-stop", "com.beaconremote.host"]).catch(
      () => {},
    );
  for (const peer of sockets.clients) peer.terminate();
  await new Promise((done) => sockets.close(done));
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
