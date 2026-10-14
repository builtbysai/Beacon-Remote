import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDisplay, physicalPoint } from "../src/remote-input.js";

test("input coordinates exclude letterboxing and map encoded video to physical monitor pixels", () => {
  // A 2560x1440 display encoded as 1280x720, fitted inside a square CSS element.
  const rect = { left: 100, top: 50, width: 800, height: 800 };
  const point = (x: number, y: number) =>
    physicalPoint(x, y, rect, 1280, 720, 2560, 1440);
  assert.equal(point(500, 100), null);
  assert.deepEqual(point(100, 225), { x: 0, y: 0 });
  assert.deepEqual(point(500, 450), { x: 1280, y: 720 });
  assert.deepEqual(point(899.9, 674.9), { x: 2559, y: 1439 });
  assert.equal(point(900, 675), null);
  assert.equal(physicalPoint(0, 0, rect, 0, 0, 2560, 1440), null);
  // The encoder itself also letterboxes older 4:3 and portrait monitors.
  const encoded = { left: 0, top: 0, width: 1280, height: 720 };
  assert.equal(physicalPoint(159, 360, encoded, 1280, 720, 1024, 768), null);
  assert.deepEqual(physicalPoint(160, 0, encoded, 1280, 720, 1024, 768), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(physicalPoint(640, 360, encoded, 1280, 720, 1024, 768), {
    x: 512,
    y: 384,
  });
  assert.equal(physicalPoint(400, 360, encoded, 1280, 720, 1080, 1920), null);
  assert.deepEqual(physicalPoint(640, 360, encoded, 1280, 720, 1080, 1920), {
    x: 540,
    y: 960,
  });
});

test("the computer's description of what is controlled is checked, and a later one is accepted the same way", () => {
  const good = JSON.stringify({
    type: "display",
    id: "0",
    width: 1080,
    height: 2400,
    platform: "android",
  });
  assert.deepEqual(parseDisplay(good)?.width, 1080);
  // Turned sideways: the same kind of message with the sizes swapped.
  assert.deepEqual(
    parseDisplay(
      JSON.stringify({ type: "display", id: "0", width: 2400, height: 1080 }),
    )?.height,
    1080,
  );
  for (const bad of [
    "not json",
    "{}",
    JSON.stringify({ type: "display", id: "", width: 10, height: 10 }),
    JSON.stringify({ type: "display", id: "0", width: 0, height: 10 }),
    JSON.stringify({ type: "display", id: "0", width: 40000, height: 10 }),
    JSON.stringify({ type: "display", id: "0", width: 1.5, height: 10 }),
    JSON.stringify({ type: "other", id: "0", width: 10, height: 10 }),
  ])
    assert.equal(parseDisplay(bad), null, bad);
});
