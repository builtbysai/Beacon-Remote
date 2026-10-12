import assert from "node:assert/strict";
import { test } from "node:test";
import { viewDeadline } from "../src/deadline.js";

test("rolling the system clock back cannot extend a viewer session", () => {
  let wall = 1_000_000;
  let monotonic = 500;
  const expired = viewDeadline(
    wall + 120_000,
    () => wall,
    () => monotonic,
  );
  assert.equal(expired(), false);
  // One minute of playback, then an hour backward clock adjustment.
  monotonic += 60_000;
  wall -= 3_600_000;
  assert.equal(expired(), false);
  monotonic += 59_999;
  assert.equal(expired(), false);
  monotonic += 1;
  assert.equal(expired(), true);
});

test("forward clock changes and already-expired grants end promptly", () => {
  let wall = 1_000;
  const expired = viewDeadline(
    2_000,
    () => wall,
    () => 0,
  );
  wall = 2_000;
  assert.equal(expired(), true);
  for (const expiresAt of [999, 1_000]) {
    assert.equal(
      viewDeadline(
        expiresAt,
        () => 1_000,
        () => 700,
      )(),
      true,
    );
  }
});

test("a fresh request gets its own original remaining budget", () => {
  let wall = 1_000;
  let monotonic = 100;
  const old = viewDeadline(
    2_000,
    () => wall,
    () => monotonic,
  );
  wall = 2_000;
  monotonic = 1_100;
  assert.equal(old(), true);
  const fresh = viewDeadline(
    3_000,
    () => wall,
    () => monotonic,
  );
  assert.equal(fresh(), false);
  monotonic = 2_100;
  assert.equal(fresh(), true);
});
