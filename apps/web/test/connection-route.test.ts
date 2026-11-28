import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyConnectionRoute,
  connectionAdvice,
} from "../src/connection-route.js";

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

test("the Connection panel leads with a plain answer", () => {
  assert.equal(connectionAdvice("Direct", "connected", 30), "Good · direct");
  assert.equal(
    connectionAdvice("Relayed", "completed", 24),
    "Good · through the relay",
  );
  assert.equal(
    connectionAdvice("Direct", "connected", 3),
    "Picture is slow · the network is busy",
  );
  assert.equal(
    connectionAdvice("Direct", "disconnected", 30),
    "Interrupted · reconnecting",
  );
  assert.match(connectionAdvice("Unavailable", "failed", null), /^Lost/);
  assert.equal(
    connectionAdvice("Not established", "checking", null),
    "Connecting…",
  );
});
