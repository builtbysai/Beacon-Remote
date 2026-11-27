import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UI_TREE_MAX_DEPTH,
  UI_TREE_MAX_NAME,
  UI_TREE_MAX_NODES,
  uiTreeRequest,
  uiTreeResponse,
} from "../src/ui-tree.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const bounds = { x: 0, y: 0, width: 10, height: 10 };
const leaf = (extra: Record<string, unknown> = {}) => ({
  role: "button",
  states: ["enabled"],
  bounds,
  children: [],
  ...extra,
});
const ok = (tree: unknown, extra: Record<string, unknown> = {}) => ({
  type: "ui-tree",
  id: ID,
  ok: true,
  truncated: false,
  tree,
  ...extra,
});

test("a request carries only its id", () => {
  assert.equal(
    uiTreeRequest.safeParse({ type: "ui-tree-request", id: ID }).success,
    true,
  );
  for (const bad of [
    { type: "ui-tree-request" },
    { type: "ui-tree-request", id: "nope" },
    { type: "ui-tree-request", id: ID, selector: "#password" },
    { type: "ui-tree", id: ID },
  ])
    assert.equal(
      uiTreeRequest.safeParse(bad).success,
      false,
      JSON.stringify(bad),
    );
});

test("a bounded tree and a refusal are both valid answers", () => {
  const tree = leaf({ role: "window", children: [leaf({ name: "Save" })] });
  assert.equal(uiTreeResponse.safeParse(ok(tree)).success, true);
  for (const reason of ["unavailable", "denied", "busy"])
    assert.equal(
      uiTreeResponse.safeParse({ type: "ui-tree", id: ID, ok: false, reason })
        .success,
      true,
      reason,
    );
  assert.equal(
    uiTreeResponse.safeParse({
      type: "ui-tree",
      id: ID,
      ok: false,
      reason: "because",
    }).success,
    false,
  );
});

test("a protected field never carries a name, and nothing extra rides along", () => {
  assert.equal(
    uiTreeResponse.safeParse(ok(leaf({ role: "password", protected: true })))
      .success,
    true,
  );
  assert.equal(
    uiTreeResponse.safeParse(
      ok(leaf({ role: "password", protected: true, name: "Password" })),
    ).success,
    false,
  );
  // A value, a text or any other field is refused, not ignored.
  for (const field of ["value", "text", "selection"])
    assert.equal(
      uiTreeResponse.safeParse(ok(leaf({ [field]: "hunter2" }))).success,
      false,
      field,
    );
  assert.equal(
    uiTreeResponse.safeParse(ok(leaf(), { extra: 1 })).success,
    false,
  );
});

test("size, depth and node count are bounded", () => {
  assert.equal(
    uiTreeResponse.safeParse(ok(leaf({ name: "n".repeat(UI_TREE_MAX_NAME) })))
      .success,
    true,
  );
  assert.equal(
    uiTreeResponse.safeParse(
      ok(leaf({ name: "n".repeat(UI_TREE_MAX_NAME + 1) })),
    ).success,
    false,
  );
  let deep = leaf();
  for (let i = 0; i < UI_TREE_MAX_DEPTH; i++) deep = leaf({ children: [deep] });
  assert.equal(uiTreeResponse.safeParse(ok(deep)).success, true);
  assert.equal(
    uiTreeResponse.safeParse(ok(leaf({ children: [deep] }))).success,
    false,
  );
  const many = (n: number) =>
    leaf({ children: Array.from({ length: n }, () => leaf()) });
  assert.equal(
    uiTreeResponse.safeParse(ok(many(UI_TREE_MAX_NODES - 1))).success,
    true,
  );
  assert.equal(
    uiTreeResponse.safeParse(ok(many(UI_TREE_MAX_NODES))).success,
    false,
  );
});

test("roles, states and boxes must be well formed", () => {
  for (const bad of [
    leaf({ role: "Bad Role!" }),
    leaf({ role: "" }),
    leaf({ states: ["enabled", "hacked"] }),
    leaf({ bounds: { ...bounds, width: -1 } }),
    leaf({ bounds: { ...bounds, x: 1.5 } }),
    leaf({ bounds: { x: 0, y: 0, width: 1 } }),
  ])
    assert.equal(
      uiTreeResponse.safeParse(ok(bad)).success,
      false,
      JSON.stringify(bad),
    );
});
