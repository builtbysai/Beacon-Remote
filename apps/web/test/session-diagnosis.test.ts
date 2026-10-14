import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnosis } from "../src/SessionHistory.js";

const quality = (
  over: Partial<NonNullable<Parameters<typeof diagnosis>[0]>>,
) => ({
  route: "Direct",
  samples: 5,
  height: 1080,
  fps: 30,
  rttMs: 20,
  rttP95Ms: 30,
  lossPct: 0,
  ...over,
});

test("a good connection says nothing; a poor one says what to try, most useful first", () => {
  assert.equal(diagnosis(null), null);
  assert.equal(diagnosis(quality({})), null);
  assert.equal(diagnosis(quality({ route: "Unavailable" })), null);
  assert.match(diagnosis(quality({ lossPct: 4, rttP95Ms: 400 }))!, /lost/);
  assert.match(diagnosis(quality({ rttP95Ms: 400 }))!, /delay/);
  assert.match(
    diagnosis(quality({ route: "Relayed", rttP95Ms: 400 }))!,
    /relay/,
  );
  assert.match(diagnosis(quality({ fps: 4 }))!, /slowly/);
  assert.match(diagnosis(quality({ route: "Relayed" }))!, /relay/);
});
