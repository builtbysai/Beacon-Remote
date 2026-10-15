#!/usr/bin/env node
// A small MCP server that lets an AI assistant look at a computer through the real Beacon Remote web viewer (ADR 0046).
//
// It is an ordinary signed-in user of the web app: it lists the account's computers, asks for a view session the way a
// person would (the person at the computer still sees a request naming this account and must allow it), and reads the
// picture from the viewer's video. There is no parallel connection, no extra authority, and nothing the account could not do
// itself in a browser. Stage one is view only: no pointer, keyboard, clipboard or files.
//
// Configure with environment variables:
//   BEACON_REMOTE_ORIGIN   the server, e.g. https://remote.example.com
//   BEACON_REMOTE_EMAIL / BEACON_REMOTE_PASSWORD   a dedicated account without two-step sign-in, or
//   BEACON_REMOTE_COOKIE   the value of that account's remote_session cookie
//   BEACON_REMOTE_MAX_SESSION_SECONDS   hard limit on one session (default 600)
//   CHROME_PATH            a Chrome or Chromium, if Playwright's is not installed
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";

const origin = (process.env.BEACON_REMOTE_ORIGIN ?? "").replace(/\/$/, "");
if (!origin) {
  console.error(
    "Set BEACON_REMOTE_ORIGIN to the Beacon Remote server address.",
  );
  process.exit(2);
}
const MAX_SECONDS = Math.min(
  3600,
  Math.max(30, Number(process.env.BEACON_REMOTE_MAX_SESSION_SECONDS) || 600),
);

let cookie = process.env.BEACON_REMOTE_COOKIE ?? "";
async function signIn() {
  if (cookie) return;
  const response = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: process.env.BEACON_REMOTE_EMAIL,
      password: process.env.BEACON_REMOTE_PASSWORD,
    }),
  });
  const set = response.headers
    .getSetCookie()
    .find((c) => c.startsWith("remote_session="));
  if (!response.ok || !set)
    throw new Error(
      "Sign-in failed. Use a dedicated account without two-step sign-in, or set BEACON_REMOTE_COOKIE.",
    );
  cookie = set.split(";")[0].replace(/^remote_session=/, "");
}
async function api(path) {
  await signIn();
  const response = await fetch(`${origin}/api/${path}`, {
    headers: { cookie: `remote_session=${cookie}` },
  });
  if (!response.ok) throw new Error(`The server answered ${response.status}`);
  return response.json();
}

// At most one session, with a hard time limit; the viewer is closed with it.
let session = null;
const text = (value) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});
const failure = (message) => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

async function endSession(reason) {
  if (!session) return false;
  const current = session;
  session = null;
  clearTimeout(current.timer);
  try {
    await current.viewer.clickText("Stop viewing");
    await new Promise((done) => setTimeout(done, 400));
  } catch {
    // The page may already be gone.
  }
  await current.viewer.close().catch(() => undefined);
  console.error(`Session ended: ${reason}`);
  return true;
}

const server = new McpServer({ name: "beacon-remote", version: "0.1.0" });

server.registerTool(
  "list_computers",
  {
    description:
      "Lists the computers this account can reach: id, name, whether it is online, and how it asks for access. Offline and revoked computers cannot be viewed.",
    inputSchema: {},
  },
  async () => {
    const { machines } = await api("machines");
    return text(
      machines
        .filter((machine) => !machine.revokedAt)
        .map((machine) => ({
          id: machine.id,
          name: machine.name,
          online: machine.online === true,
          group: machine.group ?? null,
          access:
            machine.accessMode === "trusted"
              ? "trusted (no prompt for the owner)"
              : "asks the person each time",
          temporary: machine.temporary === true,
        })),
    );
  },
);

server.registerTool(
  "request_session",
  {
    description:
      "Asks to view one computer's screen (view only). The person at the computer sees a request naming this account and must allow it; this call waits for that. Only one session can be open, and it ends by itself after a time limit.",
    inputSchema: {
      computer_id: z.string().uuid().describe("An id from list_computers"),
      wait_seconds: z
        .number()
        .int()
        .min(5)
        .max(180)
        .default(90)
        .describe("How long to wait for the person to allow it"),
    },
  },
  async ({ computer_id, wait_seconds }) => {
    if (session)
      return failure(
        "A session is already open. End it first with end_session.",
      );
    const { machines } = await api("machines");
    const machine = machines.find(
      (entry) => entry.id === computer_id && !entry.revokedAt,
    );
    if (!machine)
      return failure("That computer is not available to this account.");
    if (!machine.online) return failure(`${machine.name} is offline.`);
    await signIn();
    const viewer = await openViewer({
      origin,
      cookie,
      port: 9600 + Math.floor(Math.random() * 300),
    });
    const opened = {
      viewer,
      computer: machine.name,
      startedAt: Date.now(),
      timer: null,
    };
    session = opened;
    opened.timer = setTimeout(
      () => void endSession("time limit"),
      MAX_SECONDS * 1000,
    );
    try {
      await viewer.goto(`${origin}/#assist`);
      const clicked = await viewer.evaluate(
        `(() => { const row = document.getElementById(${JSON.stringify("device-" + computer_id)})?.closest('article'); const button = row?.querySelector('.device-open'); if (!button || button.disabled) return false; button.click(); return true; })()`,
      );
      if (!clicked) {
        await endSession("could not start");
        return failure(
          "The viewer could not start a session for that computer (it may be busy or viewing is disabled).",
        );
      }
      const end = Date.now() + wait_seconds * 1000;
      while (Date.now() < end) {
        await new Promise((done) => setTimeout(done, 1000));
        const width = await viewer.evaluate(
          "document.querySelector('video')?.videoWidth || 0",
        );
        if (width > 0)
          return text({
            status: "viewing",
            computer: machine.name,
            limit_seconds: MAX_SECONDS,
          });
        const ended = await viewer.evaluate(
          "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Close')",
        );
        if (ended) {
          await endSession("not allowed");
          return failure(
            "The request ended without being allowed (declined, expired or interrupted).",
          );
        }
      }
      await endSession("not allowed in time");
      return failure(
        "The person at the computer did not allow the request in time.",
      );
    } catch (error) {
      await endSession("error");
      return failure(`The viewer failed: ${error.message ?? error}`);
    }
  },
);

server.registerTool(
  "screenshot",
  {
    description:
      "Returns the current picture of the computer being viewed, as a PNG (at most 1280 pixels wide).",
    inputSchema: {},
  },
  async () => {
    if (!session)
      return failure("No session is open. Use request_session first.");
    const data = await session.viewer.evaluate(`(() => {
      const video = document.querySelector('video');
      if (!video || !video.videoWidth) return null;
      const scale = Math.min(1, 1280 / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    if (!data)
      return failure("There is no picture yet, or the session has ended.");
    return { content: [{ type: "image", data, mimeType: "image/png" }] };
  },
);

server.registerTool(
  "session_status",
  {
    description:
      "Says whether a session is open, which computer, how long it has left, and what the viewer shows.",
    inputSchema: {},
  },
  async () => {
    if (!session) return text({ open: false });
    const info = await session.viewer.evaluate(`(() => {
      const video = document.querySelector('video');
      const panel = video?.closest('section');
      return { picture: Boolean(video && video.videoWidth), width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0,
        viewer: (panel?.innerText ?? '').split('\\n').filter(Boolean).slice(-3).join(' | ') };
    })()`);
    return text({
      open: true,
      computer: session.computer,
      seconds_left: Math.max(
        0,
        MAX_SECONDS - Math.round((Date.now() - session.startedAt) / 1000),
      ),
      ...info,
    });
  },
);

server.registerTool(
  "end_session",
  {
    description:
      "Ends the open session and closes the viewer. The computer's own sharing window and Stop remain available to its person at all times.",
    inputSchema: {},
  },
  async () => text({ ended: await endSession("ended by the assistant") }),
);

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(
    signal,
    () => void endSession(signal).finally(() => process.exit(0)),
  );
await server.connect(new StdioServerTransport());
console.error("beacon-remote MCP server ready (view only).");
