import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/api.js";
import { backoffDelay, reconnectUntil } from "../src/reconnect.js";

const instant = async () => {};

test("an outage is retried until the session resumes, with growing delays", async () => {
  let attempts = 0;
  const waits: number[] = [];
  const result = await reconnectUntil({
    attempt: async () => {
      if (++attempts < 4) throw new TypeError("Failed to fetch");
      return "resumed";
    },
    isCurrent: () => true,
    windowMs: 120_000,
    sleep: async (ms) => {
      waits.push(ms);
    },
    random: () => 0.5,
  });
  assert.equal(result, "resumed");
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
  assert.ok(backoffDelay(50, () => 0.5) <= 15000);
});

test("the server refusing ends recovery at once; a busy server does not", async () => {
  for (const status of [401, 403, 404]) {
    let attempts = 0;
    await assert.rejects(
      reconnectUntil({
        attempt: async () => {
          attempts++;
          throw new ApiError(status);
        },
        isCurrent: () => true,
        windowMs: 120_000,
        sleep: instant,
      }),
      ApiError,
    );
    assert.equal(attempts, 1, String(status));
  }
  let tries = 0;
  assert.equal(
    await reconnectUntil({
      attempt: async () => {
        if (++tries < 3) throw new ApiError(429);
        return "ok";
      },
      isCurrent: () => true,
      windowMs: 120_000,
      sleep: instant,
    }),
    "ok",
  );
});

test("recovery gives up when the server's window has passed or the view is gone", async () => {
  let clock = 0;
  await assert.rejects(
    reconnectUntil({
      attempt: async () => {
        throw new TypeError("offline");
      },
      isCurrent: () => true,
      windowMs: 10_000,
      sleep: async (ms) => {
        clock += ms + 4000;
      },
      now: () => clock,
    }),
    /window ended/,
  );
  let current = true;
  assert.equal(
    await reconnectUntil({
      attempt: async () => {
        current = false;
        throw new TypeError("offline");
      },
      isCurrent: () => current,
      windowMs: 120_000,
      sleep: instant,
    }),
    null,
  );
});
