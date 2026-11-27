# Beacon Remote MCP server (view only)

Lets an MCP client (for example Claude Desktop or Claude Code) list your computers and look at one after the person at it allows the request.
See `docs/decisions/0046-mcp-server-view-only.md`.

Environment: `BEACON_REMOTE_ORIGIN` (HTTPS; loopback HTTP for local testing), then
`BEACON_REMOTE_EMAIL` + `BEACON_REMOTE_PASSWORD` for a dedicated test/operator account,
or `BEACON_REMOTE_COOKIE` for an existing authenticated session. Keep two-step sign-in
enabled: complete its challenge interactively and supply the resulting session cookie
through your protected local MCP configuration. No credential is written into this
repository or printed by the server. Optional: `BEACON_REMOTE_MAX_SESSION_SECONDS`
(30–3600, default 600) and `CHROME_PATH`.

Run from a checkout matching the deployed viewer version. A request reserves the
single slot before inventory lookup or browser startup. End/cancellation closes a
late-starting viewer; the hard limit includes setup. Paused, ended and reconnecting
frames cannot be captured. Shutdown requests backend Stop, closes the owned browser
and removes its temporary login profile. A cleanup failure blocks another session
until `end_session` succeeds. Hard process/OS failure can prevent cleanup; remove
only the identified owned profile after confirming its browser exited and revoke
the dedicated browser session. Session expiry and local Stop still apply.

This is stage one: view only. It does not provide mouse/keyboard, accessibility
trees, automation tokens, Motive integration or a hosted MCP service.

From the repository root, run `pnpm --filter @beacon-remote/mcp start`.
`pnpm --filter @beacon-remote/mcp test` checks the stdio protocol and session
boundaries. After entering the private development workspace,
`node tools/mcp/test-browser/live.mjs` runs the actual MCP/React/Chromium/WebRTC
journey against a local dummy API and generated canvas video. It checks view-only
requests, duplicate exclusion, paused screenshot refusal, backend Stop and profile
removal. It uses no real account, OS capture/input, physical device or provider
upload; that evidence does not establish real-device/Motive acceptance.

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

With `BEACON_MCP_CONTROL=enabled` the `ui_tree` tool also reads the names, roles, states and boxes of the shared window as a
numbered snapshot, once the person at the computer approves "Screen structure" (ADR 0064): until then it asks for it and
answers `awaiting-owner-approval`. It never includes typed text or a password field's name. A `control` pointer command may name an element from the
latest snapshot (`snapshot` and `ref`) instead of `x` and `y`; it clicks the centre of that element's box, and refuses a stale,
protected, off-screen or disabled one. Each control command leaves a receipt (number, tool, ran or the reason it was refused; never typed text, key names or clipboard contents), a retried idempotency key returns the first attempt's receipt without running again, and `control_receipts` lists them (kept for the last 200 commands of the session). Unit-tested only; no live consented session has used it.

Screenshots are sent to the assistant's provider. Use it only on computers whose owner has agreed to that.
