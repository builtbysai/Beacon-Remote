import assert from "node:assert/strict";
import test from "node:test";
import { machineSilent } from "../src/sessions.js";

test("a host that never asked for a lease is not judged silent", () => {
  assert.equal(machineSilent(undefined, 1_000_000), false);
});

test("a host that renewed recently is not silent", () => {
  assert.equal(machineSilent(1_000, 1_000), false);
  assert.equal(machineSilent(1_000, 15_000), false);
});

test("a host quiet for longer than fifteen seconds is silent", () => {
  assert.equal(machineSilent(1_000, 16_001), true);
});
