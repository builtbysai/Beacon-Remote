import assert from "node:assert/strict";
import test from "node:test";
import { pairingLink } from "../src/PairComputer.js";

test("the phone pairing link carries the code and workspace address, encoded", () => {
  const link = new URL(pairingLink("https://remote.example.com", "a-b_C+/9"));
  assert.equal(link.protocol, "beaconremote:");
  assert.equal(link.host, "pair");
  assert.equal(link.searchParams.get("code"), "a-b_C+/9");
  assert.equal(link.searchParams.get("server"), "https://remote.example.com");
});
