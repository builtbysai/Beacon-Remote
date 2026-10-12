import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TouchPad,
  type TouchEvent,
  type TouchMode,
} from "../src/touch-input.js";

function pad(mode: TouchMode) {
  return new TouchPad({
    mode: () => mode,
    scale: () => 2,
    // A 1000x500 picture drawn at 1:1 from the client origin.
    locate: (x, y) =>
      x >= 0 && y >= 0 && x < 1000 && y < 500 ? { x, y } : null,
    start: { x: 100, y: 100 },
  });
}
const ev = (
  kind: TouchEvent["kind"],
  id: number,
  time: number,
  x: number,
  y: number,
): TouchEvent => ({
  kind,
  id,
  time,
  x,
  y,
});
const click = (button: "left" | "right") => [
  { type: "button", button, down: true },
  { type: "button", button, down: false },
];

test("trackpad: a finger moves the cursor, a tap clicks, tap-then-move drags", () => {
  const touch = pad("trackpad");
  assert.deepEqual(touch.handle(ev("down", 1, 0, 50, 50)), []);
  // 20 client px at scale 2 and speed 1.6 is 64 remote px.
  assert.deepEqual(touch.handle(ev("move", 1, 20, 70, 50)), [
    { type: "move", x: 164, y: 100 },
  ]);
  assert.deepEqual(touch.handle(ev("up", 1, 40, 70, 50)), []);
  // A quick tap with no travel clicks where the cursor is.
  touch.handle(ev("down", 1, 1000, 200, 200));
  assert.deepEqual(touch.handle(ev("up", 1, 1080, 200, 200)), click("left"));
  // Press again within 300 ms and move: the button is held for a drag, released on lift.
  assert.deepEqual(touch.handle(ev("down", 1, 1200, 200, 200)), [
    { type: "button", button: "left", down: true },
  ]);
  assert.equal(touch.handle(ev("move", 1, 1230, 220, 200))[0]?.type, "move");
  assert.deepEqual(touch.handle(ev("up", 1, 1300, 220, 200)), [
    { type: "button", button: "left", down: false },
  ]);
});

test("two fingers scroll, and a two-finger tap right-clicks", () => {
  const touch = pad("trackpad");
  touch.handle(ev("down", 1, 0, 100, 100));
  touch.handle(ev("down", 2, 5, 140, 100));
  const scrolled = touch.handle(ev("move", 1, 40, 100, 130));
  assert.equal(scrolled[0]?.type, "scroll");
  touch.handle(ev("up", 1, 80, 100, 130));
  assert.deepEqual(touch.handle(ev("up", 2, 90, 140, 100)), []);
  touch.handle(ev("down", 1, 1000, 100, 100));
  touch.handle(ev("down", 2, 1010, 140, 100));
  touch.handle(ev("up", 1, 1100, 100, 100));
  assert.deepEqual(touch.handle(ev("up", 2, 1110, 140, 100)), click("right"));
});

test("direct: touch moves there, tap clicks, a held touch right-clicks once, moving drags", () => {
  const touch = pad("direct");
  assert.deepEqual(touch.handle(ev("down", 1, 0, 300, 200)), [
    { type: "move", x: 300, y: 200 },
  ]);
  assert.deepEqual(touch.handle(ev("up", 1, 100, 300, 200)), click("left"));
  touch.handle(ev("down", 1, 1000, 300, 200));
  assert.deepEqual(touch.pending(1200), []);
  assert.deepEqual(touch.pending(1500), click("right"));
  assert.deepEqual(touch.pending(1600), []);
  assert.deepEqual(touch.handle(ev("up", 1, 1700, 300, 200)), []);
  touch.handle(ev("down", 1, 3000, 300, 200));
  assert.deepEqual(touch.handle(ev("move", 1, 3040, 340, 200)), [
    { type: "button", button: "left", down: true },
    { type: "move", x: 340, y: 200 },
  ]);
  assert.deepEqual(touch.handle(ev("up", 1, 3100, 340, 200)), [
    { type: "button", button: "left", down: false },
  ]);
});

test("cancel, blur or a lost channel never leave a button held", () => {
  const touch = pad("trackpad");
  touch.handle(ev("down", 1, 0, 10, 10));
  touch.handle(ev("up", 1, 50, 10, 10));
  touch.handle(ev("down", 1, 100, 10, 10));
  assert.deepEqual(touch.handle(ev("cancel", 1, 150, 10, 10)), [
    { type: "button", button: "left", down: false },
  ]);
  assert.deepEqual(touch.release(), []);
});
