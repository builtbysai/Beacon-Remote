import assert from "node:assert/strict";
import { test } from "node:test";
import { physicalPoint } from "../src/remote-input.js";

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
