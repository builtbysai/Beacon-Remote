import assert from "node:assert/strict";
import test from "node:test";
import { RECONNECT_WINDOW_MS, startingLabel } from "../src/computer-status.js";

test("a host seen moments ago is reconnecting, not starting", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  const recent = new Date(now - 30_000).toISOString();
  const old = new Date(now - RECONNECT_WINDOW_MS - 1).toISOString();
  assert.equal(startingLabel(recent, now), "Reconnecting…");
  assert.equal(startingLabel(old, now), "Starting host");
  assert.equal(startingLabel(null, now), "Starting host");
  assert.equal(startingLabel("not a date", now), "Starting host");
});
