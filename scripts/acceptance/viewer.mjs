// A real browser for the acceptance scenarios: opens the web app signed in as the technician, so a scenario can click
// what a person would click and read what the viewer shows. Chromium is driven over the DevTools protocol; nothing is
// installed. Point CHROME_PATH at any Chrome or Chromium, or it uses the one Playwright keeps in the user's profile.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { lstat, rm } from "node:fs/promises";
import { once } from "node:events";
import { cdpConnection } from "./cdp.mjs";

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

export async function openViewer({
  origin,
  cookie,
  port = 9555,
  headless = true,
}) {
  const profile = mkdtempSync(join(tmpdir(), "beacon-viewer-"));
  const chrome = spawn(
    chromePath(),
    [
      // Physical acceptance can hand the same isolated viewer to its owner.
      ...(headless ? ["--headless=new"] : []),
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: headless },
  );
  let socket,
    closing,
    launchFailed = false;
  chrome.on("error", () => {
    launchFailed = true;
  });
  function close() {
    if (!closing)
      closing = (async () => {
        socket?.close();
        if (
          chrome.pid &&
          chrome.exitCode === null &&
          chrome.signalCode === null
        ) {
          const stopped = once(chrome, "close").catch(() => {});
          chrome.kill();
          await Promise.race([
            stopped,
            new Promise((done) => setTimeout(done, 10000)),
          ]);
        }
        // The profile contains the login cookie. Delete only this invocation's
        // exited browser profile, never an arbitrary path or running profile.
        if (
          !chrome.pid ||
          chrome.exitCode !== null ||
          chrome.signalCode !== null
        ) {
          const target = resolve(profile);
          if (
            dirname(target) !== resolve(tmpdir()) ||
            !/^beacon-viewer-[A-Za-z0-9]+$/.test(basename(target))
          )
            throw Error("Unexpected browser profile target");
          const info = await lstat(target).catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (!info) return;
          if (info.isSymbolicLink())
            throw Error("Browser profile cleanup refuses links");
          await rm(target, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
          });
        } else throw Error("Browser exit was not confirmed; retry cleanup");
      })();
    return closing.catch((error) => {
      closing = undefined;
      throw error;
    });
  }
  try {
    let pages;
    for (let attempt = 0; attempt < 40 && !pages; attempt += 1) {
      if (launchFailed) throw Error("Chrome could not start");
      await new Promise((done) => setTimeout(done, 250));
      pages = await fetch(`http://127.0.0.1:${port}/json`, {
        signal: AbortSignal.timeout(1000),
      })
        .then((r) => r.json())
        .catch(() => undefined);
    }
    if (!pages) throw new Error("Chrome did not start");
    const debuggerUrl = new URL(
      pages.find((page) => page.type === "page")?.webSocketDebuggerUrl ?? "",
    );
    if (
      debuggerUrl.protocol !== "ws:" ||
      debuggerUrl.hostname !== "127.0.0.1" ||
      debuggerUrl.port !== String(port) ||
      debuggerUrl.username ||
      debuggerUrl.password ||
      !debuggerUrl.pathname.startsWith("/devtools/page/")
    )
      throw Error("Unexpected browser debugger target");
    socket = new WebSocket(debuggerUrl);
    await new Promise((done, reject) => {
      const timer = setTimeout(
        () => reject(Error("Browser connection timed out")),
        10_000,
      );
      socket.onopen = () => {
        clearTimeout(timer);
        done();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(Error("Browser connection failed"));
      };
    });
    const send = cdpConnection(socket);
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
      if (result.result?.exceptionDetails)
        throw Error("Browser evaluation failed");
      return result.result?.result?.value;
    };
    return {
      command: send,
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
      close,
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
