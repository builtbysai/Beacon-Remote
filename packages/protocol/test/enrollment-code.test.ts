import assert from "node:assert/strict";
import { test } from "node:test";
import { ENROLLMENT_CODE_ALPHABET, enrollmentCode } from "../src/index.js";

const parse = (value: string) => enrollmentCode.safeParse(value);

test("an eight-symbol code is accepted however it is typed, and is shown as XXXX-XXXX", () => {
  for (const typed of [
    "AB3K-9PQ2",
    "ab3k-9pq2",
    "AB3K9PQ2",
    "ab3k 9pq2",
    "  AB3K - 9PQ2  ",
    "ab3k9pq2",
  ]) {
    const result = parse(typed);
    assert.equal(result.success, true, typed);
    if (result.success) assert.equal(result.data, "AB3K-9PQ2", typed);
  }
});

test("a code issued before the change (twelve symbols) stays valid", () => {
  for (const typed of ["AB3K-9PQ2-HXZ7", "ab3k9pq2hxz7"]) {
    const result = parse(typed);
    assert.equal(result.success, true, typed);
    if (result.success) assert.equal(result.data, "AB3K-9PQ2-HXZ7", typed);
  }
});

test("the symbols that are easy to confuse are never part of a code", () => {
  for (const symbol of ["I", "O", "0", "1"])
    assert.equal(ENROLLMENT_CODE_ALPHABET.includes(symbol), false, symbol);
  // A code with one of them is refused instead of guessed at.
  for (const typed of ["AB3K-9PQ0", "AB3K-9PQI", "AB3K-9PQ1", "ABOK-9PQ2"])
    assert.equal(parse(typed).success, false, typed);
});

test("wrong lengths and shapes are refused", () => {
  for (const typed of [
    "",
    "AB3K",
    "AB3K-9PQ",
    "AB3K-9PQ23",
    "AB3K-9PQ2-HXZ",
    "AB3K-9PQ2-HXZ78",
    "AB3K/9PQ2",
    "AB3K_9PQ2",
  ])
    assert.equal(parse(typed).success, false, JSON.stringify(typed));
});

test("a long operator invitation is passed through as it is", () => {
  const token = "x".repeat(43);
  const result = parse(token);
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data, token);
});
