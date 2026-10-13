import assert from "node:assert/strict";
import { test } from "node:test";
import { isModifierCode, modifierChanges } from "../src/modifiers.js";

const none = { ctrl: false, shift: false, alt: false, meta: false };

test("a shortcut without its own modifier event gets the modifier", () => {
  assert.deepEqual(modifierChanges(new Set(), { ...none, ctrl: true }), [
    { code: 0x1d, down: true },
  ]);
});

test("a modifier already held is left alone, and a stale one is released", () => {
  assert.deepEqual(
    modifierChanges(new Set([0x1d]), { ...none, ctrl: true }),
    [],
  );
  assert.deepEqual(modifierChanges(new Set([0x11d, 0x2a]), none), [
    { code: 0x11d, down: false },
    { code: 0x2a, down: false },
  ]);
  assert.equal(isModifierCode(0x15b), true);
  assert.equal(isModifierCode(0x1e), false);
});
