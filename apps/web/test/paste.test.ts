import assert from "node:assert/strict";
import { test } from "node:test";
import { PASTE_LIMIT, pasteSteps } from "../src/paste.js";

test("paste becomes bounded text pieces with Enter and Tab as keys", () => {
  const { steps, truncated } = pasteSteps("ab\r\ncd\te\u0007");
  assert.equal(truncated, false);
  assert.deepEqual(
    steps.map((step) =>
      step.type === "type_text" ? step.text : step.scanCode,
    ),
    ["ab", 0x1c, 0x1c, "cd", 0x0f, 0x0f, "e"],
  );
  assert.equal(steps[1]!.type === "key" && steps[1]!.down, true);
  assert.equal(steps[2]!.type === "key" && steps[2]!.down, false);
});

test("long text is split without breaking characters, and capped", () => {
  const long = "😀".repeat(300) + "x".repeat(PASTE_LIMIT);
  const { steps, truncated } = pasteSteps(long);
  assert.equal(truncated, true);
  const typed = steps.flatMap((step) =>
    step.type === "type_text" ? [step.text] : [],
  );
  assert.ok(typed.every((text) => text.length <= 200));
  // No piece starts or ends in the middle of a surrogate pair.
  assert.ok(typed.every((text) => Array.from(text).join("") === text));
  assert.equal(Array.from(typed.join("")).length, PASTE_LIMIT);
  assert.deepEqual(pasteSteps("\u0000\u009f").steps, []);
});
