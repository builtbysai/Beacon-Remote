// Render and interact with the real workspace using dummy local API state.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as reserve } from "node:net";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";
import { cdpConnection } from "../../../scripts/acceptance/cdp.mjs";

if (!process.env.REMOTE_DEV_STATE_DIR)
  throw Error("Enter the Remote workspace first");
const zoomReview = process.env.REMOTE_UI_ZOOM_REVIEW === "1";
const output = join(
  process.env.REMOTE_DEV_STATE_DIR,
  zoomReview
    ? "workspace-zoom-browser-2026-11-15"
    : "workspace-browser-2026-11-15",
);
await mkdir(output, { recursive: true });
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let failure = "",
  empty = false;
const machines = [
  {
    id,
    name: "Studio workstation with a deliberately long name",
    online: true,
    group: "Home office",
    // A public key, as the server lists it for pinning (ADR 0061); the details panel shows its short code.
    identityKey: "6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw",
    accessMode: "trusted",
    allowControl: true,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Travel phone",
    online: false,
    group: "Mobile",
    accessMode: "attended",
    allowControl: false,
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Retired device",
    online: false,
    group: null,
    accessMode: "attended",
    allowControl: false,
    revokedAt: "2026-11-01T00:00:00Z",
  },
].map((m) => ({
  lastSeenAt: null,
  revokedAt: null,
  helpersUnattended: "off",
  displays: [],
  ...m,
}));
const quality = {
  samples: 12,
  route: "Relayed",
  height: 1080,
  fps: 25,
  rttMs: 180,
  rttP95Ms: 280,
  lossPct: 0.1,
};
const sessions = [
  {
    id: "active",
    machineName: machines[0].name,
    source: "desktop",
    capability: "desktop:view",
    status: "active",
    createdAt: "2026-11-15T12:00:00Z",
    expiresAt: null,
  },
  {
    id: "ended",
    machineName: machines[0].name,
    source: "desktop",
    capability: "desktop:control",
    status: "ended",
    createdAt: "2026-11-14T12:00:00Z",
    expiresAt: null,
    quality,
  },
];
const events = [
  {
    id: "event1",
    action: "machine.enrolled",
    machineName: machines[0].name,
    occurredAt: "2026-11-15T12:00:00Z",
  },
  {
    id: "event2",
    action: "desktop.view.accepted",
    machineName: "Travel phone",
    actor: "long-helper-name@example.test",
    occurredAt: "2026-11-14T12:00:00Z",
  },
];
async function freePort() {
  const reservation = reserve();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const value = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  return value;
}
const vite = await createServer({
  root: resolve(import.meta.dirname, ".."),
  configFile: false,
  server: { host: "127.0.0.1", port: await freePort(), strictPort: true },
  plugins: [
    {
      name: "workspace-review-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (zoomReview && req.url === "/downloads/manifest.json") {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                version: "development-abcdef12",
                commit: "abcdef12",
                publishedAt: "2026-11-15T10:00:00Z",
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
              }),
            );
            return;
          }
          if (!req.url.startsWith("/api/")) return next();
          const path = req.url.split("?")[0];
          res.setHeader("Content-Type", "application/json");
          if (path === failure) {
            res.statusCode = 503;
            res.end("{}");
            return;
          }
          if (req.method === "POST") {
            let input = "";
            req.on("data", (b) => (input += b));
            req.on("end", () => {
              const body = JSON.parse(input || "{}");
              if (path === `/api/machines/${id}/name`) {
                machines[0].name = body.name;
                machines[0].group = body.group;
              }
              if (path === "/api/sessions/active/stop")
                sessions[0].status = "ended";
              res.end('{"ok":true}');
            });
            return;
          }
          const body = {
            "/api/machines": { machines: empty ? [] : machines },
            "/api/media/config": {
              enabled: true,
              controlEnabled: true,
              signinEnabled: false,
            },
            "/api/signup/config": { open: false, emailRecovery: false },
            "/api/activity": { events: empty ? [] : events },
            "/api/sessions": {
              available: true,
              sessions: empty ? [] : sessions,
            },
            "/api/shared": { shared: [] },
            "/api/support-links": { links: [] },
            "/api/account": {
              email: "fixture@example.test",
              createdAt: "2026-11-01T00:00:00Z",
              guestExpiresAt: null,
            },
            "/api/account/sessions": { sessions: [] },
            "/api/mfa": { available: false, enabled: false },
            "/api/team": { members: [] },
          }[path];
          res.statusCode = body ? 200 : 404;
          res.end(JSON.stringify(body ?? {}));
        });
      },
    },
  ],
});
let browser;
const results = [];
const zoomResults = [];
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const reservation = reserve();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  browser = await openViewer({
    origin,
    cookie: "synthetic-workspace-fixture",
    port,
  });
  async function wait(expression) {
    for (let i = 0; i < 60; i++) {
      if (await browser.evaluate(`Boolean(${expression})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw Error(`Timed out: ${expression}`);
  }
  async function click(selector) {
    const point = await browser.evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await browser.command("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
  }
  async function escape() {
    for (const type of ["keyDown", "keyUp"])
      await browser.command("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
  }
  async function shot(name) {
    const shot = await browser.command("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      join(output, `${name}.png`),
      Buffer.from(shot.result.data, "base64"),
    );
  }
  async function size(width, height) {
    await browser.command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  if (!zoomReview) {
    await size(1440, 900);
    await browser.goto(`${origin}/#computers`);
    await wait("document.querySelector('.device-name')");
    await click(`#device-${id}`);
    await wait(
      "document.activeElement?.getAttribute('aria-label')==='Close computer details'",
    );
    // The identity key's short code sits under the device id on the More tab.
    await click("#inspector-tab-more");
    await wait(
      "document.querySelectorAll('.device-inspector .inspector-id').length===2",
    );
    assert.match(
      await browser.evaluate(
        "document.querySelectorAll('.device-inspector .inspector-id')[1].textContent",
      ),
      /^Identity key([A-Z2-7]{4}-){5}[A-Z2-7]{4}$/,
    );
    await click("#inspector-tab-overview");
    await click(".inspector-edit");
    await wait("document.activeElement?.id==='computer-name'");
    await browser.evaluate("document.querySelector('#computer-name').select()");
    await browser.command("Input.insertText", {
      text: "Updated fixture name with enough length to test wrapping",
    });
    failure = `/api/machines/${id}/name`;
    await click(".device-inspector form .actions button");
    await wait("document.querySelector('.device-inspector [role=alert]')");
    failure = "";
    await click(".device-inspector form .actions button");
    await wait(
      "!document.querySelector('#computer-name') && document.activeElement?.classList.contains('inspector-edit')",
    );
    failure = "/api/machines";
    await wait(
      "document.querySelector('.status-dot[aria-label=\"Status unavailable\"]')",
    );
    assert.equal(
      await browser.evaluate(
        "!!document.querySelector('.device-open:not(:disabled)')",
      ),
      false,
    );
    failure = "";
    await wait("document.querySelector('.status-dot[aria-label=Online]')");
    await click(".inspector-edit");
    await wait("document.activeElement?.id==='computer-name'");
    await escape();
    await wait("document.activeElement?.classList.contains('inspector-edit')");
    await escape();
    await wait(`document.activeElement?.id==='device-${id}'`);
    assert.equal(
      await browser.evaluate("!!document.querySelector('.device-inspector')"),
      false,
    );
    await click(`#device-${id}`);
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [1280, 720],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [360, 640],
      [320, 568],
      [844, 390],
      [640, 240],
    ]) {
      await size(width, height);
      for (const route of ["computers", "sessions", "activity"]) {
        await browser.goto(`${origin}/#${route}`);
        await wait(
          `document.querySelector('h1')?.textContent==='${route[0].toUpperCase() + route.slice(1)}'`,
        );
        if (route === "computers") {
          await wait("document.querySelector('.device-name')");
          if (
            !(await browser.evaluate(
              "!!document.querySelector('.device-inspector')",
            ))
          )
            await click(`#device-${id}`);
          if (width <= 599)
            assert.ok(
              await browser.evaluate(
                "document.querySelector('.device-group').getBoundingClientRect().height<40",
              ),
              "group label must not wrap into single letters",
            );
        }
        if (route === "sessions")
          await wait("document.querySelector('.session-rows li')");
        if (route === "activity")
          await wait("document.querySelector('.activity-rows li')");
        if (route === "activity")
          assert.ok(
            await browser.evaluate(
              "Array.from(document.querySelectorAll('.activity-rows li > span')).every(el=>el.getBoundingClientRect().height>0)",
            ),
            "device and actor must remain visible on mobile",
          );
        const layout = await browser.evaluate(
          "({width:innerWidth,scroll:document.documentElement.scrollWidth})",
        );
        assert.ok(
          layout.scroll <= layout.width + 1,
          `${route} overflows at ${width}x${height}: ${JSON.stringify(layout)}`,
        );
        if ([1440, 390, 844, 640].includes(width))
          await shot(`${route}-${width}x${height}`);
        results.push({ route, width, height, ...layout });
      }
    }
    await size(1440, 900);
    failure = "/api/activity";
    await browser.goto(`${origin}/#activity`);
    await click(".activity-heading-actions button");
    await wait("document.querySelector('.activity-page [role=alert]')");
    failure = "";
    await click(".activity-heading-actions button");
    await wait("document.querySelector('.activity-rows li')");
    empty = true;
    for (const route of ["computers", "sessions", "activity"]) {
      await browser.goto(`${origin}/#${route}`);
      await wait(
        "/No (computers|sessions|activity)/i.test(document.body.innerText)",
      );
      await shot(`${route}-empty`);
    }
  }
  async function reachable(selector) {
    const result = await browser.evaluate(`(async()=>{
      const element=document.querySelector(${JSON.stringify(selector)});
      if(!element)return false;
      element.scrollIntoView({block:'center',behavior:'instant'});
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const r=element.getBoundingClientRect();
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&(hit===element||element.contains(hit));
    })()`);
    assert.ok(result, `Unreachable control at real browser zoom: ${selector}`);
  }
  if (zoomReview) {
    empty = false;
    await browser.command("Emulation.clearDeviceMetricsOverride");
    await browser.goto(`${origin}/#computers`);
    await browser.evaluate(
      "document.title='Beacon Remote synthetic zoom review'",
    );
    const baseline = await browser.evaluate(
      "({width:innerWidth,dpr:devicePixelRatio,scale:visualViewport.scale})",
    );
    await writeFile(join(output, "zoom-ready.json"), JSON.stringify(baseline));
    // Chromium's real page-zoom preference, not CSS zoom, pinch zoom or
    // viewport emulation. Only this invocation's disposable profile is changed.
    // API: chromium/src/chrome/common/extensions/api/settings_private.idl
    const created = await browser.command("Target.createTarget", {
      url: "chrome://settings/appearance",
      background: true,
    });
    const targetId = created.result.targetId;
    let zoomSocket;
    try {
      let target;
      for (let attempt = 0; attempt < 50; attempt++) {
        const pages = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(2000),
        }).then((r) => r.json());
        target = pages.find((page) => page.id === targetId);
        if (target?.webSocketDebuggerUrl) break;
        await new Promise((done) => setTimeout(done, 100));
      }
      const url = new URL(target?.webSocketDebuggerUrl ?? "");
      assert.equal(url.protocol, "ws:");
      assert.equal(url.hostname, "127.0.0.1");
      assert.equal(url.port, String(port));
      assert.ok(url.pathname.startsWith("/devtools/page/"));
      zoomSocket = new WebSocket(url);
      await new Promise((done, reject) => {
        const timer = setTimeout(
          () => reject(Error("Zoom settings connection timed out")),
          5000,
        );
        zoomSocket.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            done();
          },
          { once: true },
        );
        zoomSocket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(Error("Zoom settings connection failed"));
          },
          { once: true },
        );
      });
      const zoomCommand = cdpConnection(zoomSocket);
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const reply = await zoomCommand("Runtime.evaluate", {
          expression:
            "typeof chrome.settingsPrivate?.setDefaultZoom === 'function'",
          returnByValue: true,
        });
        if (reply.result?.result?.value === true) {
          ready = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      assert.ok(ready, "Chromium page-zoom settings are unavailable");
      const changed = await zoomCommand("Runtime.evaluate", {
        expression:
          "new Promise(resolve=>chrome.settingsPrivate.setDefaultZoom(2,resolve))",
        awaitPromise: true,
        returnByValue: true,
      });
      assert.equal(
        changed.result?.result?.value,
        true,
        "Browser refused 200% default zoom",
      );
    } finally {
      zoomSocket?.close();
      await browser.command("Target.closeTarget", { targetId });
    }
    console.log(
      "Applied Chromium's real 200% page zoom in the disposable profile.",
    );
    let zoomed = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const now = await browser.evaluate(
        "({width:innerWidth,dpr:devicePixelRatio,scale:visualViewport.scale})",
      );
      if (
        now.width <= baseline.width * 0.55 &&
        now.dpr >= baseline.dpr * 1.8 &&
        now.scale === 1
      ) {
        zoomed = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 500));
    }
    assert.ok(
      zoomed,
      "Real browser zoom was not applied; viewport emulation is insufficient",
    );
    for (const route of [
      "computers",
      "sessions",
      "activity",
      "settings",
      "downloads",
    ]) {
      await browser.goto(`${origin}/#${route}`);
      await wait(
        `document.querySelector('h1')?.textContent===${JSON.stringify(route[0].toUpperCase() + route.slice(1))}`,
      );
      if (route === "computers") {
        await click(`#device-${id}`);
        await wait("document.querySelector('.device-inspector')");
        await browser.evaluate(
          "document.querySelector('.device-inspector').scrollIntoView({block:'start',behavior:'instant'})",
        );
        await shot("inspector-browser-200pct");
        await escape();
      }
      if (route === "downloads") {
        await wait(
          'document.querySelectorAll(\'.download-platform a[href$=".exe"],.download-platform a[href$=".apk"]\').length===2',
        );
        await reachable('.download-platform a[href$=".exe"]');
        await shot("download-action-browser-200pct");
        await reachable('.download-platform a[href$=".apk"]');
      }
      if (route === "settings") {
        await click(".settings-nav [aria-controls=settings-account]");
        await wait("!document.querySelector('#settings-account').hidden");
      }
      const geometry = await browser.evaluate(
        "({width:innerWidth,scroll:document.documentElement.scrollWidth,dpr:devicePixelRatio,scale:visualViewport.scale})",
      );
      assert.ok(
        geometry.scroll <= geometry.width + 1,
        `${route} horizontal overflow at browser zoom: ${JSON.stringify(geometry)}`,
      );
      await shot(`${route}-browser-200pct`);
      const tree = await browser.command("Accessibility.getFullAXTree");
      assert.ok(
        tree.result.nodes.some(
          (node) =>
            node.role?.value === "heading" &&
            node.name?.value === route[0].toUpperCase() + route.slice(1),
        ),
        `Missing accessible heading: ${route}`,
      );
      assert.ok(
        tree.result.nodes.some(
          (node) =>
            node.role?.value === "button" &&
            /^Appearance: /.test(node.name?.value ?? ""),
        ),
        `Missing accessible appearance control: ${route}`,
      );
      zoomResults.push({
        route,
        ...geometry,
        accessibleHeadingAndAppearance: true,
      });
    }
    await writeFile(
      join(output, "zoom-result.json"),
      JSON.stringify(
        {
          scope:
            "Actual Chromium page-zoom preference; dummy local API/profile",
          baseline,
          results: zoomResults,
        },
        null,
        2,
      ),
    );
    console.log("Real 200% browser zoom review passed.");
  }
} catch (error) {
  console.error(
    await browser?.evaluate(
      "({url:location.href,text:document.body.innerText.slice(0,1500)})",
    ),
  );
  throw error;
} finally {
  try {
    try {
      await browser?.close();
    } catch {
      await new Promise((done) => setTimeout(done, 1000));
      await browser?.close();
    }
  } finally {
    await vite.close();
  }
}

await writeFile(
  join(output, "result.json"),
  JSON.stringify(
    {
      scope: "real Chromium, synthetic local API; no remote devices",
      profileCleanupConfirmed: true,
      baselineJourneys: !zoomReview,
      ...(!zoomReview
        ? {
            focus: true,
            activityRetry: true,
            emptyStates: true,
            renameErrorRetry: true,
            staleInventoryDisablesViewing: true,
          }
        : {}),
      results,
      zoomResults,
    },
    null,
    2,
  ),
);
console.log(`Workspace browser review passed: ${output}`);
