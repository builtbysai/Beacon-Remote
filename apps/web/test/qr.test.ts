import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { qrModules } from "../src/qr.js";

const fingerprint = (text: string) => {
  const modules = qrModules(text)!;
  const rows = modules.map((row) => row.map((c) => (c ? "1" : "0")).join(""));
  return `${modules.length}:${createHash("sha256").update(rows.join("\n")).digest("hex")}`;
};

// These three were checked against a reference encoder (module for module, same mask) and decoded with OpenCV.
test("the QR encoder reproduces verified codes exactly", () => {
  assert.equal(
    fingerprint("hi"),
    "21:81240590f3a630b03aa70a8aaf521ec30c4911af3307da27eeb2126afcb5b39a",
  );
  assert.equal(
    fingerprint("https://example.com/a"),
    "25:cbf8afab2391e5f07c199532c1b23bd49c919ed1430b79a207146ba95460ece8",
  );
  assert.equal(
    fingerprint(
      "beaconremote://pair?code=Abcd1234-_Zz&server=https%3A%2F%2Fremote-test.builtbysai.com",
    ),
    "41:ea9ea6575057082f4dbda1c94345e186370a7646b8be312dc7e9e81aef060671",
  );
});

test("the QR code grows with the text and has its fixed patterns", () => {
  const small = qrModules("a")!;
  const big = qrModules("x".repeat(200))!;
  assert.equal(small.length, 21);
  assert.ok(big.length > small.length);
  for (const grid of [small, big]) {
    const n = grid.length;
    // Finder corners are dark, the timing pattern alternates, and the dark module is set.
    assert.equal(grid[0]![0], true);
    assert.equal(grid[0]![n - 1], true);
    assert.equal(grid[n - 1]![0], true);
    for (let i = 8; i < n - 8; i++) assert.equal(grid[6]![i], i % 2 === 0);
    assert.equal(grid[n - 8]![8], true);
  }
});

test("text that does not fit returns null", () => {
  assert.equal(qrModules("x".repeat(214)), null);
  assert.ok(qrModules("x".repeat(213)));
});
