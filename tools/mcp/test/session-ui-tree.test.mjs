import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteSession } from "../src/session.mjs";

const COMPUTER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const bounds = { x: 0, y: 0, width: 100, height: 40 };
const tree = {
  role: "window",
  states: ["enabled"],
  bounds,
  children: [
    { role: "button", name: "Save", states: ["enabled"], bounds, children: [] },
    {
      role: "password",
      protected: true,
      states: ["enabled"],
      bounds,
      children: [],
    },
  ],
};

function rig(answers) {
  const calls = [];
  const queue = [...answers];
  const session = new RemoteSession({
    origin: "https://example.test",
    list: async () => [],
    open: async () => ({}),
    stop: async () => {},
  });
  const record = {
    deadline: Date.now() + 60_000,
    viewer: {
      evaluate: async (code) => {
        if (code.includes("beacon-ui-tree-ask")) {
          calls.push("ask");
          return true;
        }
        if (!code.includes("beacon-ui-tree-read")) return {};
        calls.push("read");
        return queue.shift();
      },
      clickText: async () => true,
      close: async () => {},
    },
  };
  session.current = record;
  return { session, record, calls };
}

test("until the owner approves, it asks once for the permission and creates no scope", async () => {
  const { session, record, calls } = rig([{ ok: false, reason: "denied" }]);
  assert.deepEqual(await session.uiTree(COMPUTER, "ui-00000001"), {
    ok: false,
    reason: "awaiting-owner-approval",
  });
  assert.deepEqual(calls, ["read", "ask"]);
  assert.equal(record.uiScope, undefined);
});

test("other refusals are passed on and create no scope", async () => {
  for (const reason of ["busy", "unavailable", "timeout", "closed"]) {
    const { session, record } = rig([{ ok: false, reason }]);
    assert.deepEqual(await session.uiTree(COMPUTER, "ui-00000001"), {
      ok: false,
      reason,
    });
    assert.equal(record.uiScope, undefined, reason);
  }
});

test("a tree the computer returned becomes a numbered snapshot, a scope and a receipt without element text", async () => {
  const { session, record } = rig([{ ok: true, truncated: false, tree }]);
  const reply = await session.uiTree(COMPUTER, "ui-00000001");
  assert.equal(reply.ok, true);
  assert.equal(reply.nodes.length, 3);
  assert.equal(reply.nodes[1].name, "Save");
  assert.equal(reply.nodes[2].protected, true);
  assert.equal("name" in reply.nodes[2], false);
  assert.deepEqual(record.uiScope.tools, ["ui_tree"]);
  assert.equal(record.uiScope.computerId, COMPUTER);
  assert.equal(reply.receipt.tool, "ui_tree");
  assert.equal(JSON.stringify(reply.receipt).includes("Save"), false);
  // The snapshot resolves a button and refuses the password field.
  assert.equal(record.snapshots.resolve(reply.snapshot, 2).ok, true);
  assert.equal(
    record.snapshots.resolve(reply.snapshot, 3).reason,
    "protected-field",
  );
});

test("a later call reads again through the scope, and a retried key is not read again", async () => {
  const { session, calls } = rig([
    { ok: true, truncated: false, tree },
    { ok: true, truncated: true, tree },
  ]);
  await session.uiTree(COMPUTER, "ui-00000001");
  const second = await session.uiTree(COMPUTER, "ui-00000002");
  assert.equal(second.ok, true);
  assert.equal(second.truncated, true);
  assert.equal(second.receipt.n, 2);
  const retry = await session.uiTree(COMPUTER, "ui-00000002");
  assert.equal(retry.duplicate, true);
  assert.equal(calls.filter((c) => c === "read").length, 2);
});

test("if the approval ends the computer says denied and the assistant gets no tree", async () => {
  const { session } = rig([
    { ok: true, truncated: false, tree },
    { ok: false, reason: "denied" },
  ]);
  await session.uiTree(COMPUTER, "ui-00000001");
  const reply = await session.uiTree(COMPUTER, "ui-00000002");
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, "denied");
  assert.equal("nodes" in reply, false);
});

test("ending the session revokes the scope, and no session means nothing is read", async () => {
  const { session, record } = rig([{ ok: true, truncated: false, tree }]);
  await session.uiTree(COMPUTER, "ui-00000001");
  await session.end(record);
  assert.equal(record.uiScope.revoked, true);
  const none = new RemoteSession({
    origin: "https://example.test",
    list: async () => [],
    open: async () => ({}),
    stop: async () => {},
  });
  assert.deepEqual(await none.uiTree(COMPUTER, "ui-00000001"), {
    ok: false,
    reason: "no-session",
  });
});
