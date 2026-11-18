import assert from "node:assert/strict";
import { test } from "node:test";
import { buildControlScript, keyCode } from "../src/control-sender.mjs";

test("key names map to the codes the viewer's input reads", () => {
  assert.equal(keyCode("a"), "KeyA");
  assert.equal(keyCode("7"), "Digit7");
  assert.equal(keyCode("Enter"), "Enter");
  assert.equal(keyCode("F13"), null);
  assert.equal(keyCode("a; alert(1)"), null);
});

test("commands the sender cannot build are refused, not guessed", () => {
  assert.equal(buildControlScript("pointer", { x: 1.5, y: 2 }), null);
  assert.equal(buildControlScript("keyboard", { key: "Unknown" }), null);
  assert.equal(buildControlScript("shell", {}), null);
  assert.equal(buildControlScript("stop", {}), null);
});

test("a pointer click builds move, press and release on the viewer's video", () => {
  const script = buildControlScript("pointer", { x: 10, y: 20, button: "left" });
  assert.match(script, /document\.querySelector\('\[data-state="viewing"\] video'\)/);
  assert.match(script, /pointerdown/);
  assert.match(script, /pointerup/);
  assert.match(script, /10 \* scale/);
});

test("arguments are embedded as data, never as code", () => {
  const script = buildControlScript("keyboard", { key: "Enter" });
  assert.match(script, /key: "Enter"/);
  assert.doesNotMatch(script, /alert/);
});
