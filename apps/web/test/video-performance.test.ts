import assert from "node:assert/strict";
import { test } from "node:test";
import {
  videoPerformance,
  type VideoCounters,
} from "../src/video-performance.js";

const before: VideoCounters = {
  id: "video",
  timestamp: 1000,
  bytesReceived: 1_000_000,
  framesDecoded: 100,
  framesDropped: 3,
  totalDecodeTime: 2,
  totalProcessingDelay: 20,
  jitterBufferDelay: 10,
  jitterBufferEmittedCount: 100,
};
const now: VideoCounters = {
  id: "video",
  timestamp: 3000,
  bytesReceived: 3_000_000,
  framesDecoded: 120,
  framesDropped: 5,
  totalDecodeTime: 2.1,
  totalProcessingDelay: 21,
  jitterBufferDelay: 10.5,
  jitterBufferEmittedCount: 120,
};

test("recent frame delays use counter differences rather than lifetime averages", () => {
  const result = videoPerformance(now, before);
  assert.equal(result.bitrateMbps, 8);
  assert.ok(Math.abs(result.decodeMs! - 5) < 0.001);
  assert.equal(result.receiveToDecodeMs, 50);
  assert.equal(result.jitterBufferMs, 25);
  assert.equal(result.droppedFrames, 2);
});

test("first sample, replaced stream and invalid time never imply zero delay", () => {
  for (const result of [
    videoPerformance(now),
    videoPerformance({ ...now, id: "replacement" }, before),
    videoPerformance({ ...now, timestamp: before.timestamp }, before),
    videoPerformance({ ...now, timestamp: NaN }, before),
  ])
    assert.ok(Object.values(result).every((value) => value === null));
});

test("missing counters, counter resets and still video do not invent latency", () => {
  const result = videoPerformance(
    {
      ...now,
      totalDecodeTime: undefined,
      jitterBufferDelay: 1,
      framesDecoded: before.framesDecoded,
    },
    before,
  );
  assert.equal(result.decodeMs, null);
  assert.equal(result.receiveToDecodeMs, null);
  assert.equal(result.jitterBufferMs, null);
  assert.equal(result.bitrateMbps, 8);
  assert.equal(
    videoPerformance({ ...now, bytesReceived: Infinity }, before).bitrateMbps,
    null,
  );
});
