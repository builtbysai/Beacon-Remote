import assert from "node:assert/strict";
import { test } from "node:test";
import { replacesRemoved } from "../src/computer-replacement.js";

const active = { id: "new", name: "Office PC", revokedAt: null };
const removed = {
  id: "old",
  name: "office pc ",
  revokedAt: "2026-11-01T00:00:00Z",
};

test("an active computer with the name of a removed one is a replacement", () => {
  assert.equal(replacesRemoved(active, [active, removed]), true);
});

test("no removed computer of that name, a different name, or a removed computer itself is not", () => {
  assert.equal(replacesRemoved(active, [active]), false);
  assert.equal(
    replacesRemoved(active, [active, { ...removed, name: "Laptop" }]),
    false,
  );
  assert.equal(replacesRemoved(removed, [active, removed]), false);
  // Two active computers that share a name are not a replacement of anything.
  assert.equal(
    replacesRemoved(active, [active, { ...removed, revokedAt: null }]),
    false,
  );
});
