import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The server speaks MCP over stdio and offers only the view-only tools; with no session open it opens nothing.
test("offers only the view-only tools and reports no session", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    env: { ...process.env, BEACON_REMOTE_ORIGIN: "http://127.0.0.1:9" },
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "end_session",
      "list_computers",
      "request_session",
      "screenshot",
      "session_status",
    ]);
    const status = await client.callTool({
      name: "session_status",
      arguments: {},
    });
    assert.match(status.content[0].text, /"open": false/);
    const shot = await client.callTool({ name: "screenshot", arguments: {} });
    assert.equal(shot.isError, true);
  } finally {
    await client.close();
  }
});
