import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyConnectionRoute } from "../src/connection-route.js";

test("a relay on either side is labelled Relayed, even under all-policy", () => {
  assert.equal(classifyConnectionRoute("relay", "srflx", "all"), "Relayed");
  assert.equal(classifyConnectionRoute("host", "relay", "all"), "Relayed");
  assert.equal(classifyConnectionRoute("host", "host", "relay"), "Relayed");
});

test("direct candidate pairs, including peer-reflexive ones, are labelled Direct", () => {
  assert.equal(classifyConnectionRoute("host", "host", "all"), "Direct");
  assert.equal(classifyConnectionRoute("prflx", "srflx", "all"), "Direct");
  assert.equal(classifyConnectionRoute("srflx", "prflx", "all"), "Direct");
});

test("unknown or missing candidate types stay Unavailable instead of guessing", () => {
  assert.equal(
    classifyConnectionRoute("unknown", "host", "all"),
    "Unavailable",
  );
  assert.equal(classifyConnectionRoute("", "", undefined), "Unavailable");
});
