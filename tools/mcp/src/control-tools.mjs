// Control tools for the MCP server (P1-1), behind the scope gate in agent-scope.mjs. Each tool validates its
// arguments, asks the gate, and only then calls a `send` function that the caller injects. Nothing here opens a
// connection: without an injected sender every accepted command returns "not-connected", so the boundary can be
// tested without a computer.

import { authorize, CONTROL_TOOLS, MAX_RECEIPTS } from "./agent-scope.mjs";

const MAX_TEXT = 512;
const MAX_CLIPBOARD = 32768;
const screenPoint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 16384;

const validators = {
  pointer(args) {
    if (!screenPoint(args.x) || !screenPoint(args.y)) return "invalid-point";
    if (
      args.button !== undefined &&
      !["left", "right", "none"].includes(args.button)
    )
      return "invalid-button";
    return null;
  },
  keyboard(args) {
    if (
      typeof args.key !== "string" ||
      args.key.length === 0 ||
      args.key.length > 32
    )
      return "invalid-key-name";
    return null;
  },
  text(args) {
    if (
      typeof args.text !== "string" ||
      args.text.length === 0 ||
      args.text.length > MAX_TEXT
    )
      return "invalid-text";
    return null;
  },
  clipboard_read() {
    return null;
  },
  ui_tree() {
    return null;
  },
  stop() {
    return null;
  },
};

/** Runs one control command. Returns { ok, reason? } or { ok, result } and never throws on a refusal. */
export async function runControl({ scope, command, send, now = Date.now() }) {
  if (!command || typeof command !== "object")
    return { ok: false, reason: "invalid" };
  if (!CONTROL_TOOLS.includes(command.tool))
    return { ok: false, reason: "unknown-tool" };
  const verdict = authorize(scope, command, now);
  if (!verdict.ok) return verdict;
  if (verdict.duplicate) {
    // A retry gets the receipt of what the first attempt did, and nothing is sent again.
    const earlier = scope.receipts.find((entry) => entry.key === command.key);
    return earlier
      ? { ok: true, duplicate: true, receipt: earlier }
      : { ok: true, duplicate: true };
  }
  const outcome = await execute({ scope, command, send });
  const receipt = {
    n: (scope.receipts.at(-1)?.n ?? 0) + 1,
    key: command.key,
    tool: command.tool,
    ok: outcome.ok,
    ...(outcome.ok ? {} : { reason: outcome.reason }),
    at: now,
  };
  scope.receipts.push(receipt);
  if (scope.receipts.length > MAX_RECEIPTS) scope.receipts.shift();
  return { ...outcome, receipt };
}

async function execute({ command, send }) {
  const problem = validators[command.tool](command.args ?? {});
  if (problem) return { ok: false, reason: problem };
  if (typeof send !== "function") return { ok: false, reason: "not-connected" };
  try {
    const result = await send(command.tool, command.args ?? {}, command.key);
    if (command.tool === "clipboard_read" && typeof result?.text === "string") {
      // The viewer's own limit: a longer copy is cut and marked, never sent whole.
      const text = result.text.slice(0, MAX_CLIPBOARD);
      return {
        ok: true,
        result: { text, truncated: result.text.length > MAX_CLIPBOARD },
      };
    }
    return { ok: true, result: result ?? null };
  } catch {
    return { ok: false, reason: "send-failed" };
  }
}

export { MAX_CLIPBOARD, MAX_TEXT };
