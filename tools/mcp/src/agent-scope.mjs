// Scope rules for agent control beyond viewing (P1-1). Stage one of the MCP server is view only (ADR 0046); this
// module is the gate any later control tool must pass first. It is pure: it decides, it sends nothing.
//
// A scope names one computer, a set of tools, and an expiry. Every tool is refused unless it is on the list
// the person granted for that scope. Commands carry an idempotency key, so a retried command runs once, and a
// per-minute bound stops a runaway agent. Nothing here grants a tool by default.

export const CONTROL_TOOLS = Object.freeze([
  "pointer",
  "keyboard",
  "text",
  "clipboard_read",
  "stop",
]);

const MAX_COMMANDS_PER_MINUTE = 120;
export const MAX_RECEIPTS = 200;
const MAX_LIFETIME_MS = 60 * 60 * 1000;

export function createScope({
  computerId,
  tools,
  expiresAt,
  now = Date.now(),
}) {
  if (typeof computerId !== "string" || computerId.length === 0)
    throw new Error("A scope needs one computer.");
  const granted = [...new Set(tools)];
  if (granted.length === 0)
    throw new Error("A scope must grant at least one tool.");
  for (const tool of granted) {
    if (!CONTROL_TOOLS.includes(tool)) throw new Error(`Unknown tool: ${tool}`);
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= now)
    throw new Error("The scope must expire in the future.");
  if (expiresAt - now > MAX_LIFETIME_MS)
    throw new Error("A scope lasts at most one hour.");
  return {
    computerId,
    tools: Object.freeze(granted),
    expiresAt,
    revoked: false,
    seenKeys: new Map(),
    recent: [],
    // What each command did, newest last, without its content (no typed text, keys or clipboard).
    receipts: [],
  };
}

export function revoke(scope) {
  scope.revoked = true;
  scope.seenKeys.clear();
  return scope;
}

/**
 * Decides one command. Returns { ok: true, duplicate } or { ok: false, reason }.
 * `duplicate` is true when the same idempotency key was already accepted: the caller returns the earlier result
 * instead of running the tool again.
 */
export function authorize(scope, command, now = Date.now()) {
  if (scope.revoked) return { ok: false, reason: "revoked" };
  if (now >= scope.expiresAt) return { ok: false, reason: "expired" };
  if (!command || typeof command !== "object")
    return { ok: false, reason: "invalid" };
  if (command.computerId !== scope.computerId)
    return { ok: false, reason: "wrong-computer" };
  if (!scope.tools.includes(command.tool))
    return { ok: false, reason: "tool-not-granted" };
  if (
    typeof command.key !== "string" ||
    command.key.length < 8 ||
    command.key.length > 64
  ) {
    return { ok: false, reason: "invalid-key" };
  }
  if (scope.seenKeys.has(command.key)) return { ok: true, duplicate: true };
  scope.recent = scope.recent.filter((time) => now - time < 60_000);
  if (scope.recent.length >= MAX_COMMANDS_PER_MINUTE)
    return { ok: false, reason: "rate-limited" };
  scope.recent.push(now);
  scope.seenKeys.set(command.key, now);
  return { ok: true, duplicate: false };
}
