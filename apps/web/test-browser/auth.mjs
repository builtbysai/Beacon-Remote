// Real React/Chromium auth UX with synthetic API and no real credentials/mail.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as portServer } from "node:net";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";

if (!process.env.REMOTE_DEV_STATE_DIR)
  throw new Error("Enter the Remote workspace first");
const output = join(
  process.env.REMOTE_DEV_STATE_DIR,
  `auth-browser-${new Date().toISOString().slice(0, 10)}`,
);
await mkdir(output, { recursive: true });
async function port() {
  const server = portServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}
let signedIn = false,
  mode = "deny",
  held = [];
const vite = await createServer({
  configFile: false,
  root: resolve(import.meta.dirname, ".."),
  server: { host: "127.0.0.1", port: await port(), strictPort: true },
  plugins: [
    {
      name: "auth-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url.startsWith("/api/")) return next();
          res.setHeader("Content-Type", "application/json");
          const send = (body, status = 200) => {
            res.statusCode = status;
            res.end(JSON.stringify(body));
          };
          if (req.method === "POST") {
            let raw = "";
            req.on("data", (chunk) => {
              raw += chunk;
            });
            req.on("end", () => {
              const body = JSON.parse(raw || "{}");
              if (req.url === "/api/login") {
                if (mode === "hold") {
                  held.push(() => {
                    signedIn = true;
                    send({ ok: true });
                  });
                  return;
                }
                if (mode === "mfa")
                  return send({
                    mfaRequired: true,
                    challenge: "fixture-challenge",
                  });
                if (mode === "ok") {
                  signedIn = true;
                  return send({ ok: true });
                }
                return send(
                  {},
                  mode === "rate" ? 429 : mode === "unverified" ? 403 : 401,
                );
              }
              if (req.url === "/api/login/mfa") {
                if (body.code !== "123456") return send({}, 401);
                signedIn = true;
                return send({ ok: true });
              }
              if (
                req.url === "/api/account/recover/request" ||
                req.url === "/api/signup"
              )
                return send({ ok: true }, 202);
              if (req.url === "/api/logout") {
                signedIn = false;
                return send({ ok: true });
              }
              return send({}, 404);
            });
            return;
          }
          if (req.url === "/api/machines")
            return send({ machines: [] }, signedIn ? 200 : 401);
          const result = {
            "/api/signup/config": { open: true, emailRecovery: true },
            "/api/media/config": { enabled: false, controlEnabled: false },
            "/api/account": {
              email: "fixture@example.test",
              createdAt: "2026-11-15T00:00:00Z",
              guestExpiresAt: null,
            },
            "/api/account/sessions": { sessions: [] },
            "/api/mfa": { available: false, enabled: false },
            "/api/team": { members: [] },
          }[req.url];
          send(result ?? {}, result ? 200 : 404);
        });
      },
    },
  ],
});
let browser;
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await openViewer({
    origin,
    cookie: "synthetic-auth-fixture",
    port: await port(),
  });
  async function wait(expression) {
    for (let i = 0; i < 60; i++) {
      if (await browser.evaluate(`Boolean(${expression})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  }
  async function click(selector) {
    const point = await browser.evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();if(!r.width||!r.height)throw Error('Hidden target');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    assert.ok(point, selector);
    for (const type of ["mousePressed", "mouseReleased"])
      await browser.command("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      });
  }
  async function fill(selector, text) {
    await click(selector);
    await browser.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).value=''`,
    );
    await browser.command("Input.insertText", { text });
  }
  async function password() {
    await fill(".login input[name=email]", "fixture@example.test");
    await fill(".login input[name=password]", "fixture-password-not-real");
  }
  async function shot(name) {
    const result = await browser.command("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      join(output, `${name}.png`),
      Buffer.from(result.result.data, "base64"),
    );
  }
  await browser.goto(`${origin}/#settings`);
  await wait("document.querySelector('.login input[name=email]')");
  await password();
  await click(".login button[type=button].password-toggle");
  assert.equal(
    await browser.evaluate(
      "document.querySelector('.login input[name=password]').type",
    ),
    "text",
  );
  await click(".login .password-toggle");
  await click(".login form > button:last-child");
  await wait("document.querySelector('.login [role=alert]')");
  assert.equal(
    await browser.evaluate("document.querySelectorAll('[role=alert]').length"),
    1,
  );
  await shot("signin-inline-error");
  mode = "mfa";
  await click(".login form > button:last-child");
  await wait("document.querySelector('.login input[name=code]')");
  await fill(".login input[name=code]", "000000");
  await click(".login form > button:not([type=button])");
  await wait("document.querySelector('.login [role=alert]')");
  await fill(".login input[name=code]", "123456");
  await click(".login form > button:not([type=button])");
  await wait("document.querySelector('.settings-page')");
  assert.equal(await browser.evaluate("location.hash"), "#settings");
  await click(".settings-nav [aria-controls=settings-account]");
  await wait("document.querySelector('#settings-account a[href=\"#forgot\"]')");
  await click('#settings-account a[href="#forgot"]');
  await wait("document.querySelector('.login input[type=email]')");
  await fill(".login input[type=email]", "fixture@example.test");
  await click(".login form button");
  await wait(
    "document.querySelector('.login [role=status]')?.textContent.includes('If that address')",
  );
  signedIn = false;
  await browser.goto(`${origin}/?fresh#signin`);
  await wait("document.querySelector('.login input[name=password]')");
  mode = "hold";
  await password();
  await click(".login form > button:last-child");
  await new Promise((done) => setTimeout(done, 5300));
  assert.equal(held.length, 1);
  for (const release of held.splice(0)) release();
  await wait(
    "document.querySelector('.heading h1')?.textContent==='Computers'",
  );
  signedIn = false;
  await browser.goto(`${origin}/?late#signin`);
  await wait("document.querySelector('.login input[name=password]')");
  await password();
  await click(".login form > button:last-child");
  await wait("document.querySelector('.login[aria-busy=true]')");
  await browser.goto(`${origin}/#home`);
  for (const release of held.splice(0)) release();
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(await browser.evaluate("location.hash"), "#home");
  signedIn = false;
  mode = "rate";
  await browser.goto(`${origin}/?rate#signin`);
  await wait("document.querySelector('.login input[name=password]')");
  await password();
  await click(".login form > button:last-child");
  await wait(
    "document.querySelector('.login [role=alert]')?.textContent.includes('Too many')",
  );
  for (const [width, height] of [
    [320, 480],
    [390, 640],
    [768, 600],
    [1024, 600],
    [1440, 900],
    [1920, 1080],
    [844, 390],
    [640, 240],
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
      `${width}x${height}`,
    );
    if (width === 320 || width === 844) await shot(`signin-${width}x${height}`);
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        inlineErrors: true,
        passwordToggle: true,
        mfa: true,
        intendedRoute: true,
        signedInRecovery: true,
        slowLogin: true,
        lateNavigation: true,
        rateLimit: true,
        responsive: true,
      },
      null,
      2,
    ),
  );
  console.log(`Auth browser review passed. Artifacts: ${output}`);
} catch (error) {
  console.error(
    await browser?.evaluate("document.body.innerText.slice(0,1000)"),
  );
  throw error;
} finally {
  for (const release of held) release();
  await browser?.close();
  await vite.close();
}
