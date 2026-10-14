// A real browser for the acceptance scenarios: opens the web app signed in as the technician, so a scenario can click
// what a person would click and read what the viewer shows. Chromium is driven over the DevTools protocol; nothing is
// installed. Point CHROME_PATH at any Chrome or Chromium, or it uses the one Playwright keeps in the user's profile.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [
    join(process.env.LOCALAPPDATA ?? "", "ms-playwright"),
    join(process.env.HOME ?? "", ".cache", "ms-playwright"),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((name) =>
      name.startsWith("chromium-"),
    )) {
      for (const exe of [
        join(root, dir, "chrome-win", "chrome.exe"),
        join(root, dir, "chrome-linux", "chrome"),
      ])
        if (existsSync(exe)) return exe;
    }
  }
  throw new Error("No Chrome found. Set CHROME_PATH.");
}

export async function openViewer({ origin, cookie, port = 9555 }) {
  const profile = mkdtempSync(join(tmpdir(), "beacon-viewer-"));
  const chrome = spawn(
    chromePath(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      `--user-data-dir=${profile}`,
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let pages;
  for (let attempt = 0; attempt < 40 && !pages; attempt += 1) {
    await new Promise((done) => setTimeout(done, 250));
    pages = await fetch(`http://127.0.0.1:${port}/json`)
      .then((r) => r.json())
      .catch(() => undefined);
  }
  if (!pages) throw new Error("Chrome did not start");
  const socket = new WebSocket(
    pages.find((page) => page.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((done) => (socket.onopen = done));
  let next = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((done) => {
      next += 1;
      waiting.set(next, done);
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  await send("Network.enable");
  const host = new URL(origin);
  await send("Network.setCookie", {
    name: "remote_session",
    value: cookie,
    domain: host.hostname,
    path: "/",
    httpOnly: true,
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result?.result?.value;
  };
  return {
    goto: async (url) => {
      await send("Page.navigate", { url });
      await new Promise((done) => setTimeout(done, 2500));
    },
    evaluate,
    // Clicks the first visible button or link whose text is exactly `text`; false if there is none.
    clickText: (text) =>
      evaluate(
        `(() => { const el = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(text)} && !e.disabled); if (!el) return false; el.click(); return true; })()`,
      ),
    close: async () => {
      socket.close();
      chrome.kill();
    },
  };
}
