# Beacon Remote MCP server (view only)

Lets an MCP client (for example Claude Desktop or Claude Code) list your computers and look at one after the person at it allows the request.
See `docs/decisions/0046-mcp-server-view-only.md`.

Environment: `BEACON_REMOTE_ORIGIN`, then `BEACON_REMOTE_EMAIL` + `BEACON_REMOTE_PASSWORD` (a dedicated account without two-step sign-in) or
`BEACON_REMOTE_COOKIE`; optional `BEACON_REMOTE_MAX_SESSION_SECONDS` and `CHROME_PATH`.

```json
{
  "mcpServers": {
    "beacon-remote": {
      "command": "node",
      "args": ["tools/mcp/src/server.mjs"],
      "env": { "BEACON_REMOTE_ORIGIN": "https://remote.example.com" }
    }
  }
}
```

Screenshots are sent to the assistant's provider. Use it only on computers whose owner has agreed to that.
