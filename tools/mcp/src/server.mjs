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
// Control tools exist only when the operator turns them on for this server process (BEACON_MCP_CONTROL=enabled).
// Without it the server stays view only, as ADR 0046 describes, and the owner's grant on the computer is still required.
const controlEnabled = process.env.BEACON_MCP_CONTROL === "enabled";
if (controlEnabled)
  server.registerTool(
    "grant_control",
    {
      description:
        "Create a short control scope for this session, only if the owner has already granted control on the computer in the sharing window. Lasts at most ten minutes and ends with the session.",
      inputSchema: { computer_id: z.string().uuid() },
    },
    async ({ computer_id }) => {
      const scope = await session.grantControlScope(
        session.current,
        computer_id,
      );
      return text(
        scope
          ? { granted: true, tools: [...scope.tools] }
          : {
              granted: false,
              reason: "the owner has not granted control on this computer",
            },
      );
    },
  );
if (controlEnabled)
  server.registerTool(
    "control",
    {
      description:
        "Run one control command in the live viewer: pointer (x, y in video pixels, optional button left|right|none), keyboard (one key name), clipboard_read, or stop. Needs grant_control first. Every command needs a unique idempotency_key of 8-64 characters; a repeated key is not run again.",
      inputSchema: {
        tool: z.enum(["pointer", "keyboard", "clipboard_read", "stop"]),
        x: z.number().int().min(0).max(16384).optional(),
        y: z.number().int().min(0).max(16384).optional(),
        button: z.enum(["left", "right", "none"]).optional(),
        key: z.string().max(32).optional(),
        // Instead of x and y, a pointer command may name an element from a ui_tree snapshot.
        snapshot: z.number().int().min(1).optional(),
        ref: z.number().int().min(1).optional(),
        idempotency_key: z.string().min(8).max(64),
      },
    },
    async ({ tool, idempotency_key, snapshot, ref, ...args }) => {
      if (snapshot !== undefined || ref !== undefined)
        args.target = { snapshot, ref };
      return text(await session.control(tool, args, idempotency_key));
    },
  );
if (controlEnabled)
  server.registerTool(
    "ui_tree",
    {
      description:
        "Read the names, roles, states and boxes of the buttons and fields in the window being shared, as a numbered snapshot that is valid for ten seconds. The person at the computer must approve 'Screen structure' first: until they do this asks for it and answers awaiting-owner-approval, so call it again afterwards. It never includes typed text or password names. Every call needs a unique idempotency_key of 8-64 characters.",
      inputSchema: {
        computer_id: z.string().uuid(),
        idempotency_key: z.string().min(8).max(64),
      },
    },
    async ({ computer_id, idempotency_key }) =>
      text(await session.uiTree(computer_id, idempotency_key)),
  );
if (controlEnabled)
  server.registerTool(
    "control_receipts",
    {
      description:
        "What the control commands of this session did, newest last: number, tool, whether it ran or why it was refused. Never includes typed text, key names or clipboard contents.",
      inputSchema: {},
    },
    async () =>
      text({
        receipts: session.current?.scope?.receipts ?? [],
        uiTreeReceipts: session.current?.uiScope?.receipts ?? [],
      }),
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
console.error(
  controlEnabled
    ? "Beacon Remote MCP ready (view, plus control the owner grants on the computer)."
    : "Beacon Remote MCP ready (view only).",
);
