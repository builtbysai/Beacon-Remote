# Agent control consent

ADR 0046 keeps the MCP server view-only. This decision sets how an assistant may be
given control (pointer, keyboard, text, clipboard read, stop) and what the owner
must see first. The gate in `tools/mcp/src/agent-scope.mjs` and the handlers in
`tools/mcp/src/control-tools.mjs` implement the checks; this record defines who
approves them.

## Who approves, and where

- The computer's owner approves a control scope on that computer, in the sharing
  window, not in the assistant. The assistant can request a scope; it cannot grant
  one to itself.
- The request names the computer, the exact tools (from the closed list), and an
  expiry of at most one hour. The owner sees all three before approving.
- Approval happens on the computer with the same local prompt used for live
  control today (`consent.rs`), so the indicator and Stop button are visible
  while the scope is in use.

## What ends a scope

- The owner's Stop or Pause on the computer, at once.
- Revoking the account's access, at once.
- Expiry, or the viewer session ending.
- Any refused command does not end the scope; it only refuses that command.

## What the assistant sees and sends

- Every control command carries an idempotency key and is bounded by the gate
  (120 per minute, one scope per computer, closed tool list).
- Clipboard reads return at most 32 KiB and are marked when cut. The assistant
  receives clipboard text only when the clipboard tool was granted.
- Screenshots still go to the assistant's provider, as ADR 0046 already states.

## Not decided here

- The sender that carries commands into a live session. It must reuse the
  viewer's existing permission and lease path, not a second connection.
- Whether trusted computers can skip the local prompt. Until that is decided,
  every control scope requires the local approval above.
- Device acceptance: none of this is verified on a computer until the owner has
  run it there.
