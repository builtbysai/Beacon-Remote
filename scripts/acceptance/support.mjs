// Automatic acceptance scenarios for temporary support (ADR 0038, 0039, 0040) across two computers.
//
//   node scripts/acceptance/support.mjs --login <login.json> [--device local|ssh:<user@host>] [--installer <path|url>]
//        [--server <url the device should use>] [--scenario <name>|all]
//
// The technician side runs here, through the product's own API. The "person" side runs scripts/acceptance/Device-Support.ps1
// either on this computer (--device local, the default, against a local fixture) or on a second Windows computer over SSH
// (--device ssh:user@host; enable the optional OpenSSH Server feature there). The login file is
// { "origin": "https://...", "email": "...", "password": "..." } for an account made for testing; nothing is created
// or kept except what the scenarios clean up. See docs/testing.md.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openViewer } from "./viewer.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, all) =>
        value.startsWith("--")
          ? [...pairs, [value.slice(2), all[index + 1]]]
          : pairs,
      [],
    ),
);
if (!args.login) {
  console.error(
    "usage: support.mjs --login <login.json> [--device local|ssh:user@host] [--installer path|url] [--server url] [--scenario name|all]",
  );
  process.exit(2);
}
const login = JSON.parse(readFileSync(resolve(args.login), "utf8"));
const origin = login.origin.replace(/\/$/, "");
const deviceKind = args.device ?? "local";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// --- technician side -------------------------------------------------------------------------------------------
let cookie = login.cookie ? `remote_session=${login.cookie}` : "";
async function signIn() {
  if (cookie) return;
  const response = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: login.email, password: login.password }),
  });
  const set = response.headers
    .getSetCookie()
    .find((c) => c.startsWith("remote_session="));
  if (!response.ok || !set)
    throw new Error(
      `sign-in failed (${response.status}); two-step accounts are not supported here`,
    );
  cookie = set.split(";")[0];
}
async function api(method, path, body) {
  const response = await fetch(`${origin}/api/${path}`, {
    method,
    headers: { origin, cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const links = async () => (await api("GET", "support-links")).body.links;
const newLink = async (capability = "desktop:view") =>
  (await api("POST", "support-links", { capability, label: "acceptance" }))
    .body;
async function waitFor(label, check, seconds = 40) {
  const end = Date.now() + seconds * 1000;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${label}`);
}
const linkById = async (id) => (await links()).find((link) => link.id === id);

// --- the person's computer ---------------------------------------------------------------------------------------
function device(action, extra = []) {
  const script = join(here, "Device-Support.ps1");
  const flags = ["-Action", action, ...extra];
  const run =
    deviceKind === "local"
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            ...flags,
          ],
          { encoding: "utf8" },
        )
      : spawnSync(
          "ssh",
          [
            deviceKind.slice(4),
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "beacon-acceptance/Device-Support.ps1",
            ...flags,
          ],
          { encoding: "utf8" },
        );
  const line = run.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`device ${action} failed: ${run.stderr || run.stdout}`);
  }
}
if (deviceKind.startsWith("ssh:")) {
  const copied = spawnSync(
    "scp",
    ["-r", here, `${deviceKind.slice(4)}:beacon-acceptance`],
    { encoding: "utf8" },
  );
  if (copied.status !== 0)
    throw new Error(`could not copy the device scripts: ${copied.stderr}`);
}
async function installerReference() {
  if (args.installer) return args.installer;
  // The real route: whatever the Downloads page would offer.
  const manifest = await (
    await fetch(`${origin}/downloads/manifest.json`)
  ).json();
  return `${origin}/downloads/${manifest.installer.file}`;
}

async function start(capability) {
  const link = await newLink(capability);
  const begun = device("Start", [
    "-Link",
    link.url,
    "-Installer",
    await installerReference(),
    ...(args.server ? ["-Server", args.server] : []),
  ]);
  if (!begun.answeredYes)
    throw new Error("the support program never asked to start");
  const ready = await waitFor("the computer to appear as ready", async () => {
    const current = await linkById(link.id);
    return current?.state === "connected" ? current : null;
  });
  return { link, ready };
}
const expectClean = async (label) => {
  const state = await waitFor(
    `${label}: nothing left on the computer`,
    () => {
      const now = device("State");
      return !now.folder &&
        now.processes === 0 &&
        !now.runOnce &&
        now.downloads === 0
        ? now
        : null;
    },
    45,
  );
  return state;
};

// Opens a view session in a real browser and says what arrived: whether the picture played and whether a sound
// track came with it. `sound` is whether the person ticks "share this computer's sound" when they allow it.
async function watch(sound) {
  const { link } = await start("desktop:view");
  const viewer = await openViewer({
    origin,
    cookie: cookie.replace(/^remote_session=/, ""),
  });
  try {
    await viewer.goto(`${origin}/#assist`);
    await waitFor("the View button", () => viewer.clickText("View"), 25);
    const consent = device("Consent", [
      "-Seconds",
      "30",
      ...(sound ? ["-Sound"] : []),
    ]);
    if (!consent.allowed)
      throw new Error(consent.reason ?? "the request was not allowed");
    await waitFor(
      "the picture",
      async () =>
        (await viewer.evaluate(
          "document.querySelector('video')?.videoWidth || 0",
        )) > 0,
      60,
    );
    const tracks = await viewer.evaluate(
      "document.querySelector('video').srcObject.getAudioTracks().length",
    );
    const button = await viewer.evaluate(
      "[...document.querySelectorAll('button')].some(b => /^Sound (on|off)$/.test(b.textContent.trim()))",
    );
    return { link, tracks, button };
  } finally {
    await viewer.close();
  }
}

// --- scenarios ---------------------------------------------------------------------------------------------------
const scenarios = {
  async "person ends support"() {
    const { link } = await start();
    device("Press", ["-Title", "Temporary support", "-Button", "End support"]);
    await waitFor(
      "the link to end",
      async () => (await linkById(link.id))?.state === "ended",
    );
    const ended = await linkById(link.id);
    if (ended.endedBy !== "recipient")
      throw new Error(`ended by ${ended.endedBy}`);
    await expectClean("person ends support");
  },
  async "technician ends support"() {
    const { link } = await start();
    await api("POST", `support-links/${link.id}/end`, {});
    await expectClean("technician ends support");
  },
  async "support survives the window crashing"() {
    const { link, ready } = await start();
    device("Crash", ["-Mode", "window"]);
    const back = device("WaitWindow", [
      "-Title",
      "Temporary support",
      "-Seconds",
      "30",
    ]);
    if (!back.found) throw new Error("the window did not come back");
    await waitFor(
      "the computer to be ready again",
      async () => (await linkById(link.id))?.state === "connected",
    );
    if ((await linkById(link.id)).machineId !== ready.machineId)
      throw new Error("a different computer came back");
    await api("POST", `support-links/${link.id}/end`, {});
    await expectClean("crash and resume");
  },
  async "support survives everything being killed and a restart"() {
    const { link } = await start();
    device("Crash", ["-Mode", "all"]);
    const resumed = device("Resume");
    if (!resumed.resumed)
      throw new Error(resumed.reason ?? "nothing to resume from");
    await waitFor(
      "the computer to be ready again",
      async () => (await linkById(link.id))?.state === "connected",
    );
    await api("POST", `support-links/${link.id}/end`, {});
    await expectClean("restart and resume");
  },
  async "the local time limit ends support"() {
    const { link } = await start();
    device("ExpireLocal");
    await waitFor(
      "the link to end",
      async () => (await linkById(link.id))?.state === "ended",
      60,
    );
    await expectClean("local time limit");
  },
  async "chat reaches both sides"() {
    const { link, ready } = await start();
    await api("POST", `machines/${ready.machineId}/chat`, {
      text: "Hello from the technician",
    });
    let shown = "";
    await waitFor(
      "the person to see the message",
      () => {
        shown = device("ChatText").text ?? "(no chat box found)";
        return shown.includes("Technician: Hello from the technician");
      },
      40,
    ).catch((error) => {
      throw new Error(
        `${error.message}; the window showed ${JSON.stringify(shown)}`,
      );
    });
    if (!device("Say", ["-Text", "Hello from the person"]).sent)
      throw new Error("could not send from the window");
    await waitFor(
      "the technician to see the reply",
      async () => {
        const { body } = await api(
          "GET",
          `machines/${ready.machineId}/chat?since=0`,
        );
        return body.messages.some(
          (m) => m.sender === "person" && m.body === "Hello from the person",
        );
      },
      40,
    );
    await api("POST", `support-links/${link.id}/end`, {});
    await expectClean("chat");
  },
  async "no sound is shared unless the person ticks it"() {
    const seen = await watch(false);
    if (seen.tracks !== 0 || seen.button)
      throw new Error(
        `sound arrived without being agreed (${seen.tracks} tracks)`,
      );
    await api("POST", `support-links/${seen.link.id}/end`, {});
    await expectClean("no sound");
  },
  async "sound is shared when the person ticks it"() {
    const seen = await watch(true);
    if (seen.tracks !== 1 || !seen.button)
      throw new Error(
        `expected one sound track and a Sound button, got ${seen.tracks} and ${seen.button}`,
      );
    await api("POST", `support-links/${seen.link.id}/end`, {});
    await expectClean("sound");
  },
  async "a connection request asks the person and a view link refuses control"() {
    const { link, ready } = await start("desktop:view");
    const refused = await api("POST", `machines/${ready.machineId}/sessions`, {
      source: "desktop",
      capability: "desktop:control",
    });
    if (refused.status !== 403)
      throw new Error(`control on a view link answered ${refused.status}`);
    const asked = await api("POST", `machines/${ready.machineId}/sessions`, {
      source: "desktop",
      capability: "desktop:view",
    });
    if (asked.status !== 200)
      throw new Error(`view request answered ${asked.status}`);
    const window = device("WaitWindow", [
      "-Title",
      "incoming connection request",
      "-Seconds",
      "30",
    ]);
    if (!window.found) throw new Error("the person was never asked");
    await api("POST", `support-links/${link.id}/end`, {});
    await expectClean("connection request");
  },
};

// --- run ---------------------------------------------------------------------------------------------------------
await signIn();
const chosen =
  !args.scenario || args.scenario === "all"
    ? Object.keys(scenarios)
    : [args.scenario];
let failed = 0;
for (const name of chosen) {
  if (!scenarios[name]) {
    console.error(
      `unknown scenario "${name}". Available:\n  ${Object.keys(scenarios).join("\n  ")}`,
    );
    process.exit(2);
  }
  device("Reset");
  const started = Date.now();
  try {
    await scenarios[name]();
    console.log(
      `PASS  ${name} (${Math.round((Date.now() - started) / 1000)}s)`,
    );
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}: ${error.message}`);
  } finally {
    device("Reset");
    for (const link of (await links()).filter((l) =>
      ["waiting", "connected", "offline"].includes(l.state),
    ))
      await api("POST", `support-links/${link.id}/end`, {});
  }
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
