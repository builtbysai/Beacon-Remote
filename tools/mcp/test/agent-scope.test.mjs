import assert from "node:assert/strict";
import { test } from "node:test";
import { authorize, createScope, revoke } from "../src/agent-scope.mjs";

const now = 1_000_000;
const later = now + 60_000;
const base = { computerId: "pc-1", tool: "pointer", key: "cmd-00000001" };

function scope(tools = ["pointer"]) {
  return createScope({ computerId: "pc-1", tools, expiresAt: now + 600_000, now });
}

test("only granted tools on the named computer are allowed", () => {
  const s = scope(["pointer"]);
  assert.deepEqual(authorize(s, base, now), { ok: true, duplicate: false });
  assert.equal(authorize(s, { ...base, tool: "keyboard", key: "cmd-00000002" }, now).reason, "tool-not-granted");
  assert.equal(authorize(s, { ...base, computerId: "pc-2", key: "cmd-00000003" }, now).reason, "wrong-computer");
});

test("a repeated key runs once and reports the duplicate", () => {
  const s = scope();
  authorize(s, base, now);
  assert.deepEqual(authorize(s, base, later), { ok: true, duplicate: true });
});

test("revocation and expiry stop everything at once", () => {
  const s = scope();
  assert.equal(authorize(s, base, now + 600_000).reason, "expired");
  revoke(s);
  assert.equal(authorize(s, { ...base, key: "cmd-00000009" }, now).reason, "revoked");
});

test("scopes default to nothing and are bounded in time and tool names", () => {
  assert.throws(() => createScope({ computerId: "pc-1", tools: [], expiresAt: now + 1000, now }));
  assert.throws(() => createScope({ computerId: "pc-1", tools: ["shell"], expiresAt: now + 1000, now }));
  assert.throws(() => createScope({ computerId: "pc-1", tools: ["pointer"], expiresAt: now + 2 * 3600_000, now }));
});

test("bad keys and floods are refused", () => {
  const s = scope();
  assert.equal(authorize(s, { ...base, key: "short" }, now).reason, "invalid-key");
  for (let i = 0; i < 120; i++) authorize(s, { ...base, key: `flood-${String(i).padStart(4, "0")}` }, now);
  assert.equal(authorize(s, { ...base, key: "flood-9999" }, now).reason, "rate-limited");
  assert.equal(authorize(s, { ...base, key: "flood-9998" }, now + 61_000).ok, true);
});
