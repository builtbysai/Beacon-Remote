import assert from "node:assert/strict";
import test from "node:test";
import { lockKeyFor, lockScreenShape } from "../src/lock-screen.js";

test("a PIN screen layout is accepted only in its exact shape", () => {
  const good = {
    type: "lockscreen",
    state: "pad",
    w: 1080,
    h: 2400,
    nodes: [
      { x: 146, y: 1022, w: 221, h: 221, text: "1", kind: "key" },
      { x: 0, y: 242, w: 1080, h: 73, text: "Enter PIN", kind: "text" },
    ],
  };
  assert.equal(lockScreenShape(good)?.nodes.length, 2);
  assert.equal(lockScreenShape({ ...good, state: "other" }), null);
  assert.equal(lockScreenShape({ ...good, w: 0 }), null);
  assert.equal(lockScreenShape({ ...good, nodes: "x" }), null);
  assert.equal(
    lockScreenShape({ ...good, nodes: new Array(61).fill(good.nodes[0]) }),
    null,
  );
  assert.equal(
    lockScreenShape({
      ...good,
      nodes: [{ ...good.nodes[0], text: "x".repeat(25) }],
    }),
    null,
  );
  assert.equal(
    lockScreenShape({ ...good, nodes: [{ ...good.nodes[0], kind: "script" }] }),
    null,
  );
  assert.equal(
    lockScreenShape({ type: "lockscreen", state: "no-pad", w: 1, h: 1 })?.nodes
      .length,
    0,
  );
  assert.equal(lockScreenShape(null), null);
});

test("only digits, Delete and Enter captions stand for pressable keys", () => {
  assert.equal(lockKeyFor("7"), "7");
  assert.equal(lockKeyFor("Delete"), "delete");
  assert.equal(lockKeyFor("Enter"), "enter");
  assert.equal(lockKeyFor("Emergency"), null);
  assert.equal(lockKeyFor("12"), null);
});

test("a pattern or password lock screen needs no keys, and an unknown lock kind falls back to PIN", () => {
  const base = { type: "lockscreen", state: "pad", w: 1080, h: 2400 };
  assert.equal(lockScreenShape({ ...base, lock: "pattern" })?.lock, "pattern");
  assert.equal(
    lockScreenShape({ ...base, lock: "password" })?.lock,
    "password",
  );
  assert.equal(
    lockScreenShape({ ...base, lock: "other", nodes: [] })?.lock,
    "pin",
  );
});
