import assert from "node:assert/strict";
import test from "node:test";
import { viewerAttachGraceOpen } from "../src/sessions.js";

test("a new session stays alive while its first viewer is still attaching", () => {
  assert.equal(viewerAttachGraceOpen(1_000, 1_000), true);
  assert.equal(viewerAttachGraceOpen(1_000, 2_500), true);
  assert.equal(viewerAttachGraceOpen(1_000, 11_000), true);
});

test("the wait ends after ten seconds so a viewer that never comes cannot hold the phone", () => {
  assert.equal(viewerAttachGraceOpen(1_000, 11_001), false);
});
