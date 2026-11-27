// Real React and Chromium interaction; isolated synthetic account/API only.
// No retained credentials, production server, host or OS settings are used.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer as portServer } from "node:net";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";
import { reviewSettings } from "./settings-review.mjs";
import { reviewPairing } from "./pairing-review.mjs";
import { reviewAssist } from "./assist-review.mjs";

const root = resolve(import.meta.dirname, "../../..");
if (!process.env.REMOTE_DEV_STATE_DIR)
  throw new Error("Enter the Remote workspace first.");
const output = join(
  process.env.REMOTE_DEV_STATE_DIR,
  `appearance-browser-${new Date().toISOString().slice(0, 10)}`,
);
await mkdir(output, { recursive: true });
let manifestMode = "published",
  accountFixture = true;
const heldManifests = new Set();
let settingsFailure = "",
  mfaEnabled = false,
  otherSessions = true;
let members = [];
const settingsWrites = [];
let sharedFailure = false,
  supportRequests = 0;
const supportPending = [],
  supportStops = [];
let pairingMode = "waiting",
  pairingCount = 0,
  pairingCancels = 0,
  pairedMachine = false;
const pairings = new Map(),
  heldPairingCreates = [],
  heldPairingStatuses = [];
const pairingMachine = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "New fixture computer",
  online: false,
  createdAt: "2026-11-11T00:00:00Z",
  lastSeenAt: null,
  revokedAt: null,
  accessMode: "attended",
  allowControl: false,
  group: null,
  displays: [],
};
const published = {
  version: "development-abcdef12",
  commit: "abcdef12",
  publishedAt: "2026-11-11T10:00:00Z",
  file: "BeaconRemoteDevelopment-abcdef12.zip",
  bytes: 10485760,
  sha256: "a".repeat(64),
  installer: {
    file: "BeaconRemoteSetup-abcdef12.exe",
    bytes: 12582912,
    sha256: "b".repeat(64),
  },
  android: {
    file: "BeaconRemoteHost-abcdef12.apk",
    bytes: 8388608,
    sha256: "c".repeat(64),
    signer: "d".repeat(64),
  },
  signing: {
    certificate: "beacon-remote-signing.cer",
    sha256: "e".repeat(64),
    script: "Trust-BeaconRemote.ps1",
    scriptSha256: "f".repeat(64),
    notAfter: "2027-11-11T00:00:00Z",
  },
};
async function freePort() {
  const reservation = portServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  return port;
}
const server = await createServer({
  configFile: false,
  root: join(root, "apps/web"),
  server: { host: "127.0.0.1", port: await freePort(), strictPort: true },
  plugins: [
    {
      name: "isolated-appearance-review",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const preview =
            /^\/__mail\/(verify|recover|existing|operations)$/.exec(req.url);
          if (preview) {
            void readFile(
              join(
                process.env.REMOTE_DEV_STATE_DIR,
                "mail-previews",
                `${preview[1]}.html`,
              ),
              "utf8",
            )
              .then((html) => {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(html);
              })
              .catch(() => {
                res.statusCode = 404;
                res.end("Generate dummy mail previews first.");
              });
            return;
          }
          if (req.url === "/downloads/manifest.json") {
            if (manifestMode === "loading") {
              heldManifests.add(res);
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.statusCode =
              manifestMode === "missing"
                ? 404
                : manifestMode === "error"
                  ? 503
                  : 200;
            res.end(
              JSON.stringify(
                manifestMode === "invalid"
                  ? { ...published, file: "../unsafe.zip" }
                  : manifestMode === "zip"
                    ? {
                        ...published,
                        installer: undefined,
                        android: undefined,
                        signing: undefined,
                      }
                    : published,
              ),
            );
            return;
          }
          if (!req.url.startsWith("/api/")) return next();
          if (req.url === "/api/shared" && sharedFailure) {
            res.statusCode = 503;
            res.end("{}");
            return;
          }
          if (req.url === settingsFailure) {
            res.statusCode = 503;
            res.end("{}");
            return;
          }
          if (req.method === "POST") {
            let data = "";
            req.on("data", (chunk) => {
              data += chunk;
            });
            req.on("end", () => {
              const body = JSON.parse(data || "{}");
              settingsWrites.push({ path: req.url, body });
              let result = { ok: true };
              if (
                [
                  "/api/support/claim",
                  "/api/support/guest",
                  "/api/relationships/fixture-shared/sessions",
                  "/api/machines/fixture-support-machine/sessions",
                ].includes(req.url)
              ) {
                const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(++supportRequests).padStart(12, "0")}`;
                supportPending.push(() => {
                  res.setHeader("Content-Type", "application/json");
                  res.end(
                    JSON.stringify({
                      id,
                      source: "desktop",
                      capability: "desktop:view",
                      approval: "local",
                      expiresAtMillis: Date.now() + 60000,
                      reconnectSeconds: 30,
                      iceServers: [],
                      iceTransportPolicy: "all",
                      machineName: "Support fixture",
                    }),
                  );
                });
                return;
              } else if (/^\/api\/sessions\/[^/]+\/stop$/.test(req.url))
                supportStops.push(req.url);
              else if (req.url === "/api/enrollments") {
                const code = String(++pairingCount).padStart(32, "A");
                pairings.set(code, {
                  state: "waiting",
                  machine: null,
                  expiresAt: new Date(Date.now() + 300000).toISOString(),
                });
                result = { code, expiresInSeconds: 300 };
                if (pairingMode === "late-create") {
                  heldPairingCreates.push(() =>
                    res.end(JSON.stringify(result)),
                  );
                  return;
                }
              } else if (
                req.url === "/api/enrollments/status" ||
                req.url === "/api/enrollments/cancel"
              ) {
                const item = pairings.get(body.code);
                if (
                  pairingMode === "unavailable" &&
                  req.url.endsWith("status")
                ) {
                  res.statusCode = 404;
                  res.end("{}");
                  return;
                }
                if (!item) {
                  res.statusCode = 404;
                  res.end("{}");
                  return;
                }
                if (req.url.endsWith("cancel")) {
                  if (pairingMode === "cancel-error") {
                    res.statusCode = 503;
                    res.end("{}");
                    return;
                  }
                  pairingCancels++;
                  if (pairingMode === "claim-on-cancel") {
                    item.state = "claimed";
                    item.machine = {
                      id: pairingMachine.id,
                      name: pairingMachine.name,
                    };
                    pairedMachine = true;
                  } else if (item.state === "waiting") item.state = "cancelled";
                } else {
                  if (pairingMode === "status-error") {
                    res.statusCode = 503;
                    res.end("{}");
                    return;
                  }
                  if (pairingMode === "hold-status") {
                    const snapshot = JSON.stringify(item);
                    heldPairingStatuses.push(() => res.end(snapshot));
                    return;
                  }
                  if (pairingMode === "expired") item.state = "expired";
                }
                result = item;
              } else if (req.url === "/api/mfa/setup")
                result = {
                  secret: "JBSWY3DPEHPK3PXP",
                  otpauthUrl:
                    "otpauth://totp/BeaconFixture?secret=JBSWY3DPEHPK3PXP",
                };
              else if (req.url === "/api/mfa/enable") {
                if (body.code !== "123456") {
                  res.statusCode = 401;
                  result = {};
                } else {
                  mfaEnabled = true;
                  result = {
                    recoveryCodes: [
                      "fixture-recovery-one",
                      "fixture-recovery-two",
                    ],
                  };
                }
              } else if (req.url === "/api/mfa/disable") mfaEnabled = false;
              else if (req.url === "/api/account/sessions/end-others")
                otherSessions = false;
              else if (req.url === "/api/team")
                members = [
                  {
                    id: "fixture-member",
                    email: body.email,
                    role: body.role,
                    group: body.group,
                    computers: 0,
                  },
                ];
              else if (req.url === "/api/team/fixture-member/remove")
                members = [];
              else if (req.url === "/api/account/export")
                result = { account: { email: "fixture@example.test" } };
              else if (req.url === "/api/account/delete") {
                res.statusCode = 401;
                result = {};
              } else {
                res.statusCode = 404;
                result = {};
              }
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(result));
            });
            return;
          }
          if (req.url === "/api/machines" && !accountFixture) {
            res.statusCode = 401;
            res.end("{}");
            return;
          }
          const body = {
            "/api/shared": {
              shared: [
                {
                  id: "fixture-shared",
                  machineName: "Shared fixture computer",
                  capability: "desktop:view",
                  expiresAtMillis: null,
                  ownerEmail: "fixture@example.test",
                  team: true,
                  online: true,
                },
              ],
            },
            "/api/support-links": {
              links: [
                {
                  id: "fixture-link",
                  label: "Fixture recipient",
                  capability: "desktop:view",
                  state: "connected",
                  endedBy: null,
                  machineId: "fixture-support-machine",
                  name: "Support fixture",
                  expiresAtMillis: Date.now() + 60000,
                  untilMillis: null,
                  notes: null,
                },
              ],
            },
            "/api/machines": {
              machines: pairedMachine ? [pairingMachine] : [],
            },
            "/api/media/config": { enabled: false, controlEnabled: false },
            "/api/signup/config": { open: false, emailRecovery: false },
            "/api/account": {
              email: "long-fixture-account-address@example.test",
              createdAt: "2026-11-01T00:00:00Z",
              guestExpiresAt: null,
            },
            "/api/account/sessions": {
              sessions: [
                { expiresAt: "2026-12-01T00:00:00Z", current: true },
                ...(otherSessions
                  ? [{ expiresAt: "2026-12-01T00:00:00Z", current: false }]
                  : []),
              ],
            },
            "/api/mfa": { available: true, enabled: mfaEnabled },
            "/api/team": { members },
          }[req.url.split("?")[0]];
          res.setHeader("Content-Type", "application/json");
          res.statusCode = body ? 200 : 404;
          res.end(JSON.stringify(body ?? { error: "Not a fixture endpoint" }));
        });
      },
    },
  ],
});
let browser;
const results = [];
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const reservation = portServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  browser = await openViewer({
    origin,
    cookie: "synthetic-appearance-fixture",
    port,
  });
  await browser.command("Page.enable");
  async function waitFor(expression) {
    for (let i = 0; i < 60; i++) {
      if (await browser.evaluate(`Boolean(${expression})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  }
  async function key(key, code = key) {
    await browser.command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode: {
        Escape: 27,
        Tab: 9,
        ArrowRight: 39,
        ArrowDown: 40,
        " ": 32,
      }[key],
    });
    await browser.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
    });
  }
  async function click(selector) {
    const point = await browser.evaluate(
      `(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    await browser.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await browser.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  }
  async function screenshot(name) {
    const shot = await browser.command("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      join(output, `${name}.png`),
      Buffer.from(shot.result.data, "base64"),
    );
  }
  // The header switch is light or dark only; following the system is chosen in Settings.
  const chooseSystem = async () => {
    await browser.evaluate(
      `[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='Appearance').click()`,
    );
    await waitFor("document.querySelector('.theme-choice')");
    await browser.evaluate(
      `[...document.querySelectorAll('.theme-choice-option')].find(b=>b.textContent.trim()==='System').click()`,
    );
    await waitFor(
      "document.querySelector('.theme-choice-option[aria-checked=true]')?.textContent.trim()==='System'",
    );
    assert.equal(
      await browser.evaluate(
        "/System/.test(document.querySelector('.theme-trigger').getAttribute('aria-label'))",
      ),
      false,
      "the header switch never offers System",
    );
  };
  const setTheme = async (label) => {
    for (let i = 0; i < 3; i++) {
      if (
        await browser.evaluate(
          `document.querySelector('.theme-trigger')?.getAttribute('aria-label')==='Appearance: ${label}'`,
        )
      )
        return;
      await click(".theme-trigger");
    }
    await waitFor(
      `document.querySelector('.theme-trigger')?.getAttribute('aria-label')==='Appearance: ${label}'`,
    );
  };
  await browser.goto(`${origin}/#settings`);
  await waitFor("document.querySelector('.theme-trigger')");
  await setTheme("Dark");
  await waitFor("document.documentElement.dataset.theme==='dark'");
  assert.equal(
    await browser.evaluate("localStorage.getItem('beacon-remote-appearance')"),
    "dark",
  );
  await browser.command("Network.setBlockedURLs", {
    urls: ["*/src/main.tsx*"],
  });
  await browser.goto(`${origin}/?bootstrap-review#settings`);
  assert.equal(
    await browser.evaluate("document.documentElement.dataset.theme"),
    "dark",
  );
  assert.equal(
    await browser.evaluate("document.querySelector('#root').childElementCount"),
    0,
  );
  await browser.command("Network.setBlockedURLs", { urls: [] });
  await browser.command("Page.reload");
  await waitFor(
    "document.querySelector('.theme-trigger')?.getAttribute('aria-label')==='Appearance: Dark'",
  );
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
    [1024, 600],
    [768, 600],
    [390, 640],
    [320, 480],
    [844, 390],
    [640, 240],
  ]) {
    await browser.command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const geometry = await browser.evaluate(
      `(() => {const t=document.querySelector('.theme-trigger').getBoundingClientRect(); return {fits:t.left>=0&&t.top>=0&&t.right<=innerWidth&&t.bottom<=innerHeight, tap:t.width>=44&&t.height>=44, overflow:document.documentElement.scrollWidth>innerWidth};})()`,
    );
    assert.deepEqual(
      geometry,
      { fits: true, tap: true, overflow: false },
      `${width}x${height}`,
    );
    if ([1440, 320, 844].includes(width))
      await screenshot(`dark-${width}x${height}`);
    results.push({ viewport: `${width}x${height}`, ...geometry });
  }
  await chooseSystem();
  await browser.command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await waitFor("document.documentElement.dataset.theme==='light'");
  await browser.command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await waitFor("document.documentElement.dataset.theme==='dark'");
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await setTheme("Light");
  await waitFor("document.documentElement.dataset.theme==='light'");
  await screenshot("light-settings-1440x900");
  await browser.goto(`${origin}/#home`);
  await screenshot("light-public-1440x900");
  await browser.goto(`${origin}/#settings`);
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 640,
    height: 240,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.command("Emulation.setEmulatedMedia", {
    features: [{ name: "forced-colors", value: "active" }],
  });
  await screenshot("forced-colors-640x240");
  await browser.command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  const injection = await browser.command(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage blocked for fixture')}});`,
    },
  );
  assert.ok(injection.result?.identifier);
  await browser.goto(`${origin}/?storage-blocked#settings`);
  assert.equal(
    await browser.evaluate(
      "(() => {try {localStorage.getItem('x'); return false;}catch {return true;}})()",
    ),
    true,
  );
  // With no saved choice the header shows the look the device prefers, and one press flips it.
  const systemIsDark = await browser.evaluate(
    "matchMedia('(prefers-color-scheme: dark)').matches",
  );
  await waitFor(
    `document.querySelector('.theme-trigger')?.getAttribute('aria-label')==='Appearance: ${systemIsDark ? "Dark" : "Light"}'`,
  );
  await click(".theme-trigger");
  await waitFor(
    `document.documentElement.dataset.theme==='${systemIsDark ? "light" : "dark"}'`,
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await reviewSettings({
    browser,
    click,
    key,
    waitFor,
    screenshot,
    setFailure: (value) => {
      settingsFailure = value;
    },
  });
  assert.ok(
    settingsWrites.some(
      (item) => item.path === "/api/mfa/enable" && item.body.code === "123456",
    ),
  );
  await reviewPairing({
    browser,
    click,
    key,
    waitFor,
    screenshot,
    origin,
    setMode: (value) => {
      pairingMode = value;
    },
    releaseCreate: () => {
      for (const release of heldPairingCreates.splice(0)) release();
    },
    releaseStatus: () => {
      for (const release of heldPairingStatuses.splice(0)) release();
    },
    fixture: () => ({
      pairingCount,
      pairingCancels,
      heldCreates: heldPairingCreates.length,
      heldStatuses: heldPairingStatuses.length,
    }),
  });
  await reviewAssist({
    browser,
    click,
    waitFor,
    screenshot,
    origin,
    setSharedFailure: (value) => {
      sharedFailure = value;
    },
    release: () => {
      for (const done of supportPending.splice(0)) done();
    },
    fixture: () => ({
      requests: supportRequests,
      stops: supportStops.length,
      pending: supportPending.length,
    }),
  });
  assert.ok(
    settingsWrites.some(
      (item) =>
        item.path === "/api/team" &&
        item.body.role === "viewer" &&
        item.body.group === null,
    ),
  );
  await browser.goto(`${origin}/#downloads`);
  await waitFor(
    "document.querySelectorAll('.download-platform a[download]').length>=2",
  );
  assert.deepEqual(
    await browser.evaluate(
      "Array.from(document.querySelectorAll('.download-platform > a[download]')).map(el=>new URL(el.href).pathname)",
    ),
    [
      "/downloads/BeaconRemoteSetup-abcdef12.exe",
      "/downloads/BeaconRemoteHost-abcdef12.apk",
    ],
  );
  assert.equal(
    await browser.evaluate(
      "document.querySelectorAll('.download-platform details').length",
    ),
    0,
  );
  await screenshot("downloads-desktop");
  for (const [width, height] of [
    [320, 480],
    [390, 640],
    [768, 600],
    [844, 390],
    [1920, 1080],
  ]) {
    await browser.command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.equal(
      await browser.evaluate(
        "document.documentElement.scrollWidth<=innerWidth",
      ),
      true,
      `Download details overflow ${width}x${height}`,
    );
    if (width === 320) {
      await browser.evaluate(
        "document.querySelector('.download-platform .verify').scrollIntoView({block:'start'});window.scrollBy(0,-80)",
      );
      await screenshot("downloads-phone-details");
    }
  }
  for (const mode of ["missing", "error", "invalid", "zip", "loading"]) {
    manifestMode = mode;
    await browser.goto(`${origin}/?downloads-${mode}#downloads`);
    if (mode === "loading")
      await waitFor(
        "document.querySelector('.download-platforms[aria-busy=true]')",
      );
    else if (mode === "zip") {
      await waitFor(
        "document.querySelector('.download-platform > a[download]')",
      );
      assert.equal(
        await browser.evaluate(
          "document.querySelector('.download-platform > a[download]').getAttribute('href')",
        ),
        `/downloads/${published.file}`,
      );
      assert.equal(
        await browser.evaluate(
          "document.querySelectorAll('.download-platform > button:disabled').length",
        ),
        1,
      );
    } else {
      await waitFor(
        "document.querySelector('.download-platforms[aria-busy=false]')",
      );
      assert.equal(
        await browser.evaluate(
          "document.querySelectorAll('.download-platform a[download]').length",
        ),
        0,
      );
      assert.equal(
        await browser.evaluate(
          "!!document.querySelector('.downloads-page [role=alert]')",
        ),
        mode !== "missing",
      );
      if (mode === "error") {
        manifestMode = "published";
        await click(".downloads-page .error button");
        await waitFor(
          "document.querySelector('.download-platform > a[download]')",
        );
      }
    }
  }
  manifestMode = "published";
  accountFixture = false;
  await browser.goto(`${origin}/?public-downloads#downloads`);
  await waitFor(
    "document.querySelector('.public-shell .download-platform > a[download]')",
  );
  assert.equal(
    await browser.evaluate(
      "document.querySelectorAll('.download-platform > a[download]').length",
    ),
    2,
  );
  for (const mode of ["verify", "recover", "existing", "operations"]) {
    for (const [width, height, color] of [
      [320, 760, "light"],
      [768, 800, "dark"],
    ]) {
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await browser.command("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: color }],
      });
      await browser.goto(`${origin}/__mail/${mode}`);
      assert.equal(
        await browser.evaluate(
          "document.documentElement.scrollWidth<=innerWidth",
        ),
        true,
        `${mode} mail overflow at ${width}`,
      );
      assert.equal(
        await browser.evaluate(
          "document.querySelectorAll('img,script,iframe').length",
        ),
        0,
      );
      assert.ok(
        await browser.evaluate("document.querySelector('h1')?.textContent"),
      );
      if (width === 320 || mode === "verify")
        await screenshot(`mail-${mode}-${color}-${width}`);
    }
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        scope: "real browser, synthetic API",
        results,
        keyboard: true,
        focusReturn: true,
        persistence: true,
        liveSystemChanges: true,
        forcedColors: true,
        storageBlocked: true,
        beforeReact: true,
        publicHeader: true,
        settings: true,
        pairing: true,
        assistLateRequests: true,
        mailPreviews: true,
        downloads: {
          published: true,
          detailsReflow: true,
          missing: true,
          errorRetry: true,
          malformed: true,
          zipFallback: true,
          loading: true,
          publicAndWorkspace: true,
        },
      },
      null,
      2,
    ),
  );
  console.log(`Appearance browser review passed. Artifacts: ${output}`);
} catch (error) {
  console.error(
    await browser?.evaluate(
      "({url:location.href,text:document.body.innerText.slice(0,1600)})",
    ),
  );
  throw error;
} finally {
  for (const done of supportPending) done();
  for (const release of [...heldPairingCreates, ...heldPairingStatuses])
    release();
  for (const response of heldManifests) response.end();
  await browser?.close();
  await server.close();
}
