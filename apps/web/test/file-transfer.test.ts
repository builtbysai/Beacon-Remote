import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { Sha256 } from "../src/file-transfer.js";

test("incremental SHA-256 matches the platform hash for every padding boundary and chunking", () => {
  for (const length of [
    0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 100_003,
  ]) {
    const data = randomBytes(length);
    const expected = createHash("sha256").update(data).digest("hex");
    for (const step of [1, 7, 16384, 99_999]) {
      const hash = new Sha256();
      for (let offset = 0; offset < data.length; offset += step)
        hash.update(data.subarray(offset, offset + step));
      assert.equal(hash.hex(), expected, `${length} bytes in steps of ${step}`);
    }
  }
});

test("reading the digest does not disturb a hash that keeps going", () => {
  const first = randomBytes(100);
  const second = randomBytes(77);
  const hash = new Sha256().update(first);
  hash.hex();
  hash.update(second);
  assert.equal(
    hash.hex(),
    createHash("sha256").update(first).update(second).digest("hex"),
  );
});
