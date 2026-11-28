import assert from "node:assert/strict";
import test from "node:test";
import { activityLabel, readableAction } from "../src/AccountPanels.js";

test("current backend events read as plain words, never as internal names", () => {
  for (const action of [
    "signin.wake.requested",
    "signin.lease.requested",
    "signin.handoff.connected",
    "machine.uninstalled",
    "machine.restart.requested",
    "account.exported",
    "support.link.claimed",
  ]) {
    const label = activityLabel(action);
    assert.notEqual(label, action);
    assert.doesNotMatch(label, /[._]/);
  }
  assert.equal(
    activityLabel("signin.wake.requested"),
    "Password prompt brought up",
  );
});

test("an event the page does not know yet still reads as words", () => {
  assert.equal(
    readableAction("machine.future_thing:view"),
    "Machine future thing view",
  );
  assert.equal(readableAction(""), "Activity");
});
