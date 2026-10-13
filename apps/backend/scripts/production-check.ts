// Real-process check of a deployed server with a disposable computer, no browser:
// sign in with a test account, pair a throwaway agent, turn trusted access on from the computer,
// request a desktop session and confirm consent and a media offer arrive with no one clicking Allow,
// then stop the session and revoke the throwaway computer.
// Needs .remote-dev/prod-test-login.json ({origin,email,password}) and `cargo build --release`.
// The real helper starts, so the visible sharing indicator appears on this desktop for a moment.
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";

if (process.platform !== "win32") throw new Error("Windows required");
const root = resolve(import.meta.dirname, "../../..");
const login = JSON.parse(
  await readFile(resolve(root, ".remote-dev/prod-test-login.json"), "utf8"),
) as { origin: string; email: string; password: string };
const profile = resolve(root, `.remote-dev/prod-check/profile-${randomUUID()}`);
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

let cookie = "";
const call = async (path: string, body?: unknown) => {
  const response = await fetch(`${login.origin}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: login.origin,
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, response, json: () => response.json() };
};

let agent: ChildProcess | undefined;
let machineId = "";
let socket: WebSocket | undefined;
try {
  const signedIn = await fetch(`${login.origin}/api/login`, {
    method: "POST",
    headers: { origin: login.origin, "content-type": "application/json" },
    body: JSON.stringify({ email: login.email, password: login.password }),
  });
  check(signedIn.status === 200, "the test account signs in");
  cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
  const media = await (await call("media/config")).json();
  check(
    media.enabled && media.controlEnabled,
    "production has sessions and control on",
  );
  check(media.iceServers?.length > 0, "production issues relay servers");

  const enrollment = await (await call("enrollments", {})).json();
  await mkdir(profile, { recursive: true });
  await run(
    "beacon-remote-agent",
    ["pair"],
    `${login.origin}\nProduction check computer\n${enrollment.code}\n`,
  );
  machineId = (
    (await (await call("machines")).json()).machines as {
      id: string;
      revokedAt: string | null;
    }[]
  ).find((machine) => !machine.revokedAt)!.id;
  pass("a throwaway computer paired with production");
  await run("beacon-remote-agent", ["access", "trusted"]);
  agent = spawn(bin("beacon-remote-agent"), ["run"], {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  let online = false;
  for (let waited = 0; waited < 20_000 && !online; waited += 500) {
    online = (await (await call("machines")).json()).machines.some(
      (machine: { id: string; online: boolean }) =>
        machine.id === machineId && machine.online,
    );
    if (!online) await sleep(500);
  }
  check(online, "the computer reports presence to production");
  const listed = (await (await call("machines")).json()).machines.find(
    (machine: { id: string }) => machine.id === machineId,
  );
  check(
    listed.accessMode === "trusted" && listed.displays.length > 0,
    `production sees trusted access and ${listed.displays.length} displays`,
  );

  // PROD_HOLD=<seconds>: keep the throwaway computer online so a browser can view it by hand.
  if (process.env.PROD_HOLD) {
    console.log(
      `Holding the throwaway computer online for ${process.env.PROD_HOLD} s; view it in the workspace.`,
    );
    await sleep(Number(process.env.PROD_HOLD) * 1000);
    console.log("Hold finished.");
    throw new Error("HOLD_DONE");
  }
  const created = await call(`machines/${machineId}/sessions`, {
    source: "desktop",
    capability: "desktop:view",
  });
  check(created.status === 200, "production creates a desktop session");
  const session = await created.json();
  check(session.approval === "policy", "approved by the computer's own policy");

  const seen: string[] = [];
  socket = new WebSocket(
    `${login.origin.replace("https", "wss")}/api/sessions/${session.id}/signal?role=viewer`,
    { headers: { cookie, origin: login.origin } },
  );
  socket.on("message", (data) => seen.push(JSON.parse(data.toString()).type));
  const waitFor = async (type: string, ms: number) => {
    for (let waited = 0; waited < ms; waited += 100) {
      if (seen.includes(type)) return true;
      await sleep(100);
    }
    return false;
  };
  check(
    await waitFor("consent", 25_000),
    "consent arrives with no one clicking Allow",
  );
  check(
    await waitFor("offer", 25_000),
    "the helper offers media through production",
  );
  await call(`sessions/${session.id}/stop`, {});
  pass("the session is stopped");
  console.log("Production check: all checks passed.");
} catch (error) {
  if ((error as Error).message !== "HOLD_DONE") throw error;
} finally {
  socket?.terminate();
  agent?.kill();
  await sleep(1500);
  if (machineId) await call(`machines/${machineId}/revoke`, {});
  await rm(resolve(root, ".remote-dev/prod-check"), {
    recursive: true,
    force: true,
  });
}
