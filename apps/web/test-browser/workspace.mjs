// Render and interact with the real workspace using dummy local API state.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as reserve } from "node:net";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";

if (!process.env.REMOTE_DEV_STATE_DIR)
  throw Error("Enter the Remote workspace first");
const output = join(
  process.env.REMOTE_DEV_STATE_DIR,
  "workspace-browser-2026-11-15",
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
const vite = await createServer({
  root: resolve(import.meta.dirname, ".."),
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "workspace-review-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
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
  await size(1440, 900);
  await browser.goto(`${origin}/#computers`);
  await wait("document.querySelector('.device-name')");
  await click(`#device-${id}`);
  await wait(
    "document.activeElement?.getAttribute('aria-label')==='Close computer details'",
  );
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
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        scope: "real Chromium, synthetic local API; no remote devices",
        focus: true,
        activityRetry: true,
        emptyStates: true,
        renameErrorRetry: true,
        staleInventoryDisablesViewing: true,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Workspace browser review passed: ${output}`);
} catch (error) {
  console.error(
    await browser?.evaluate(
      "({url:location.href,text:document.body.innerText.slice(0,1500)})",
    ),
  );
  throw error;
} finally {
  await browser?.close();
  await vite.close();
}
