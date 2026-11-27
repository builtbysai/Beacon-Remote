import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIMITS,
  buildNodes,
  createSnapshotStore,
  receiptFor,
} from "../src/ui-snapshot.mjs";

const box = { x: 10, y: 20, width: 100, height: 30 };
const tree = {
  role: "window",
  name: "Settings",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  children: [
    { role: "button", name: "Save", states: ["enabled", "bogus"], bounds: box },
    {
      role: "password",
      name: "Account password",
      value: "hunter2",
      bounds: box,
    },
    {
      role: "edit",
      name: "Card number",
      protected: true,
      value: "4111",
      bounds: box,
    },
    {
      role: "Bad Role!",
      name: "x",
      bounds: { x: 1, y: 1, width: -1, height: 1 },
    },
  ],
};

test("only role, name, states and bounds are kept, and protected fields keep no text", () => {
  const { nodes } = buildNodes(tree);
  assert.equal(nodes.length, 5);
  assert.deepEqual(nodes[1], {
    ref: 2,
    parent: 1,
    role: "button",
    name: "Save",
    states: ["enabled"],
    bounds: box,
  });
  for (const index of [2, 3]) {
    assert.equal(nodes[index].protected, true);
    assert.equal("name" in nodes[index], false);
    assert.equal("value" in nodes[index], false);
  }
  const text = JSON.stringify(nodes);
  for (const secret of ["hunter2", "4111", "Account password", "Card number"])
    assert.equal(text.includes(secret), false, secret);
  // An invalid role becomes "unknown" and an invalid box is dropped.
  assert.equal(nodes[4].role, "unknown");
  assert.equal(nodes[4].bounds, null);
});

test("depth and node limits hold and the cut is reported", () => {
  let deep = { role: "group", bounds: box };
  const root = deep;
  for (let i = 0; i < LIMITS.maxDepth + 5; i++) {
    deep.children = [{ role: "group", bounds: box }];
    deep = deep.children[0];
  }
  const tall = buildNodes(root);
  assert.equal(tall.nodes.length, LIMITS.maxDepth + 1);
  assert.equal(tall.truncated, true);
  const wide = buildNodes({
    role: "list",
    children: Array.from({ length: 2000 }, () => ({
      role: "item",
      bounds: box,
    })),
  });
  assert.equal(wide.nodes.length, LIMITS.maxNodes);
  assert.equal(wide.truncated, true);
  assert.equal(buildNodes({ role: "a" }).truncated, false);
});

test("a long name is cut", () => {
  const { nodes } = buildNodes({
    role: "text",
    name: "x".repeat(5000),
    bounds: box,
  });
  assert.equal(nodes[0].name.length, LIMITS.maxName);
});

test("a target resolves inside its snapshot and is refused once stale, unknown or protected", () => {
  const store = createSnapshotStore();
  const now = 1_000_000;
  const first = store.add(tree, now);
  assert.equal(store.resolve(first.snapshot, 2, now + 1).ok, true);
  assert.deepEqual(store.resolve(first.snapshot, 99, now + 1), {
    ok: false,
    reason: "unknown-ref",
  });
  assert.deepEqual(store.resolve(first.snapshot, "2", now + 1), {
    ok: false,
    reason: "unknown-ref",
  });
  assert.deepEqual(store.resolve(first.snapshot, 3, now + 1), {
    ok: false,
    reason: "protected-field",
  });
  assert.deepEqual(store.resolve(first.snapshot, 5, now + 1), {
    ok: false,
    reason: "no-bounds",
  });
  assert.deepEqual(store.resolve(7, 1, now + 1), {
    ok: false,
    reason: "unknown-snapshot",
  });
  assert.deepEqual(store.resolve(first.snapshot, 2, now + LIMITS.lifetimeMs), {
    ok: false,
    reason: "stale-snapshot",
  });
  // Once expired it is gone, not revivable.
  assert.deepEqual(store.resolve(first.snapshot, 2, now + 1), {
    ok: false,
    reason: "unknown-snapshot",
  });
});

test("a ref from one snapshot never reaches another, and only the newest few are kept", () => {
  const store = createSnapshotStore();
  const now = 5_000;
  const a = store.add(
    {
      role: "window",
      bounds: box,
      children: [{ role: "button", name: "A", bounds: box }],
    },
    now,
  );
  const b = store.add({ role: "window", bounds: box }, now);
  assert.equal(store.resolve(a.snapshot, 2, now + 1).ok, true);
  assert.deepEqual(store.resolve(b.snapshot, 2, now + 1), {
    ok: false,
    reason: "unknown-ref",
  });
  for (let i = 0; i < LIMITS.maxSnapshots; i++)
    store.add({ role: "w", bounds: box }, now);
  assert.deepEqual(store.resolve(a.snapshot, 2, now + 1), {
    ok: false,
    reason: "unknown-snapshot",
  });
});

test("a receipt names the role and the number and carries no element text", () => {
  const store = createSnapshotStore();
  const shot = store.add(tree, 1);
  const resolved = store.resolve(shot.snapshot, 2, 2);
  const receipt = receiptFor(shot.snapshot, resolved.node);
  assert.deepEqual(receipt, {
    snapshot: shot.snapshot,
    ref: 2,
    role: "button",
  });
  assert.equal(JSON.stringify(receipt).includes("Save"), false);
});
