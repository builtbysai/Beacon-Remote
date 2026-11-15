#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";
import { RemoteSession, accountApi, checkedOrigin } from "./session.mjs";
import { createServer } from "node:net";

let origin;
try {
  origin = checkedOrigin(process.env.BEACON_REMOTE_ORIGIN ?? "");
} catch {
  console.error(
    "Set BEACON_REMOTE_ORIGIN to an HTTPS server origin (loopback HTTP is allowed for testing).",
  );
  process.exit(2);
}
const maxSeconds = Math.floor(
  Math.min(
    3600,
    Math.max(30, Number(process.env.BEACON_REMOTE_MAX_SESSION_SECONDS) || 600),
  ),
);
const account = accountApi({
  origin,
  cookie: process.env.BEACON_REMOTE_COOKIE,
  email: process.env.BEACON_REMOTE_EMAIL,
  password: process.env.BEACON_REMOTE_PASSWORD,
});
const list = async () => {
  const data = await account.api("machines");
  if (!Array.isArray(data.machines)) throw Error("Invalid inventory");
  return data.machines;
};
const session = new RemoteSession({
  origin,
  list,
  maxMs: maxSeconds * 1000,
  stop: (id) => account.api(`sessions/${id}/stop`, {}),
  open: async () => {
    const reservation = createServer();
    await new Promise((done, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", done);
    });
    const port = reservation.address().port;
    await new Promise((done) => reservation.close(done));
    return openViewer({ origin, cookie: await account.getCookie(), port });
  },
});
const text = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const failure = () => ({
  isError: true,
  content: [
    {
      type: "text",
      text: "The request failed. Check account sign-in and server availability.",
    },
  ],
});
const server = new McpServer({ name: "beacon-remote", version: "0.1.0" });
server.registerTool(
  "list_computers",
  {
    description:
      "Lists this account's non-revoked devices. Does not start sharing.",
    inputSchema: {},
  },
  async () => {
    try {
      return text(
        (await list())
          .filter((m) => !m.revokedAt)
          .map((m) => ({
            id: m.id,
            name: m.name,
            online: m.online === true,
            group: m.group ?? null,
            access:
              m.accessMode === "trusted"
                ? "locally enabled owner standing access"
                : "local approval required",
            temporary: m.temporary === true,
          })),
      );
    } catch {
      return failure();
    }
  },
);
server.registerTool(
  "request_session",
  {
    description:
      "Request one view-only session through the real web viewer. Existing local approval/owner standing-access policy and Stop apply. No input, clipboard or files. Concurrent requests are refused; the session has a hard time limit.",
    inputSchema: {
      computer_id: z.string().uuid(),
      wait_seconds: z.number().int().min(5).max(180).default(90),
    },
  },
  (input, extra) => session.request(input, extra.signal),
);
server.registerTool(
  "screenshot",
  {
    description:
      "Return the active viewer picture as PNG, at most 1280 pixels in either dimension. Paused, ended and reconnecting pictures are unavailable. The image is sent to the MCP client's assistant provider.",
    inputSchema: {},
  },
  () => session.screenshot(),
);
server.registerTool(
  "session_status",
  { description: "Current session state and remaining time.", inputSchema: {} },
  () => session.status(),
);
server.registerTool(
  "end_session",
  {
    description:
      "End the session, request backend Stop and close its viewer. Also cancels setup in progress.",
    inputSchema: {},
  },
  async () => text({ ended: await session.end() }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(
    signal,
    () =>
      void session
        .end()
        .catch(() =>
          console.error(
            "Viewer cleanup could not be confirmed; inspect local browser state before reuse.",
          ),
        )
        .finally(() => process.exit(0)),
  );
await server.connect(new StdioServerTransport());
console.error("Beacon Remote MCP ready (view only).");
