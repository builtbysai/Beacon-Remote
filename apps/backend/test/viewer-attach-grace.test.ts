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

import { hostReconnectOpen, silentHostShouldDetach } from "../src/sessions.js";

test("a detached host may re-attach only inside its twenty second window", () => {
  assert.equal(hostReconnectOpen(undefined, 5_000), false);
  assert.equal(hostReconnectOpen(25_000, 5_000), true);
  assert.equal(hostReconnectOpen(25_000, 24_999), true);
  assert.equal(hostReconnectOpen(25_000, 25_000), false);
});

test("a silent unattended host is held for re-attach; attended, non-resumable or already-detached sessions are not", () => {
  const quiet = 20_000; // longer than the silence limit
  const base = {
    machineDetachedUntil: undefined,
    machineRenewedAt: 1_000,
    resumable: true,
    approval: "policy",
  };
  assert.equal(silentHostShouldDetach(base, 1_000 + quiet), true);
  assert.equal(silentHostShouldDetach(base, 2_000), false);
  assert.equal(
    silentHostShouldDetach({ ...base, approval: "local" }, 1_000 + quiet),
    false,
  );
  assert.equal(
    silentHostShouldDetach({ ...base, resumable: false }, 1_000 + quiet),
    false,
  );
  assert.equal(
    silentHostShouldDetach(
      { ...base, machineDetachedUntil: 50_000 },
      1_000 + quiet,
    ),
    false,
  );
  assert.equal(
    silentHostShouldDetach(
      { ...base, machineRenewedAt: undefined },
      1_000 + quiet,
    ),
    false,
  );
});
