import assert from "node:assert/strict";
import { test } from "node:test";
import { createScope, revoke } from "../src/agent-scope.mjs";
import { runControl, MAX_CLIPBOARD } from "../src/control-tools.mjs";

const now = 2_000_000;
const make = (tools) =>
  createScope({ computerId: "pc-1", tools, expiresAt: now + 600_000, now });
let n = 0;
const cmd = (tool, args = {}) => ({
  computerId: "pc-1",
  tool,
  args,
  key: `ctl-${String(++n).padStart(8, "0")}`,
});

test("nothing is sent without a connected computer", async () => {
  const s = make(["pointer"]);
  assert.deepEqual(
    await runControl({
      scope: s,
      command: cmd("pointer", { x: 1, y: 1 }),
      now,
    }),
    {
      ok: false,
      reason: "not-connected",
    },
  );
});

test("an ungranted or revoked tool never reaches the sender", async () => {
  const sent = [];
  const send = async (...args) => sent.push(args);
  const s = make(["pointer"]);
  assert.equal(
    (
      await runControl({
        scope: s,
        command: cmd("keyboard", { key: "a" }),
        send,
        now,
      })
    ).reason,
    "tool-not-granted",
  );
  revoke(s);
  assert.equal(
    (
      await runControl({
        scope: s,
        command: cmd("pointer", { x: 1, y: 1 }),
        send,
        now,
      })
    ).reason,
    "revoked",
  );
  assert.deepEqual(sent, []);
});

test("arguments are checked before anything is sent", async () => {
  const sent = [];
  const send = async (...args) => sent.push(args);
  const s = make(["pointer", "text", "keyboard"]);
  assert.equal(
    (
      await runControl({
        scope: s,
        command: cmd("pointer", { x: -1, y: 0 }),
        send,
        now,
      })
    ).reason,
    "invalid-point",
  );
  assert.equal(
    (
      await runControl({
        scope: s,
        command: cmd("text", { text: "" }),
        send,
        now,
      })
    ).reason,
    "invalid-text",
  );
  assert.equal(
    (
      await runControl({
        scope: s,
        command: cmd("keyboard", { key: "" }),
        send,
        now,
      })
    ).reason,
    "invalid-key-name",
  );
  assert.deepEqual(sent, []);
});

test("a valid pointer command is sent once and a retried key is not sent again", async () => {
  const sent = [];
  const send = async (tool, args) => {
    sent.push([tool, args]);
    return null;
  };
  const s = make(["pointer"]);
  const command = cmd("pointer", { x: 10, y: 20, button: "left" });
  assert.equal((await runControl({ scope: s, command, send, now })).ok, true);
  assert.deepEqual(await runControl({ scope: s, command, send, now }), {
    ok: true,
    duplicate: true,
  });
  assert.deepEqual(sent, [["pointer", { x: 10, y: 20, button: "left" }]]);
});

test("clipboard reads are cut to the viewer's limit and marked", async () => {
  const long = "x".repeat(MAX_CLIPBOARD + 10);
  const s = make(["clipboard_read"]);
  const reply = await runControl({
    scope: s,
    command: cmd("clipboard_read"),
    send: async () => ({ text: long }),
    now,
  });
  assert.equal(reply.result.text.length, MAX_CLIPBOARD);
  assert.equal(reply.result.truncated, true);
});

test("a failing sender is reported without leaking details", async () => {
  const s = make(["stop"]);
  const reply = await runControl({
    scope: s,
    command: cmd("stop"),
    send: async () => {
      throw new Error("socket path /tmp/secret");
    },
    now,
  });
  assert.deepEqual(reply, { ok: false, reason: "send-failed" });
});
