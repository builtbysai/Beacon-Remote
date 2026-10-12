import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveViewRequest } from "../src/view-request.js";

test("navigation/logout discards a delayed grant without opening a viewer", async () => {
  let settle!: (grant: { id: string }) => void;
  const response = new Promise<{ id: string }>((resolve) => {
    settle = resolve;
  });
  const original = { active: true };
  let context = original;
  const opened: string[] = [];
  const stopped: string[] = [];
  const pending = resolveViewRequest(
    response,
    () => original.active,
    (grant) => opened.push(grant.id),
    async (grant) => stopped.push(grant.id),
  );
  // Leave and return: the new context must not revive the old request.
  context.active = false;
  context = { active: true };
  assert.equal(context.active, true);
  settle({ id: "old-request" });
  await pending;
  assert.deepEqual(opened, []);
  assert.deepEqual(stopped, ["old-request"]);
});

test("failed cleanup after logout never opens the discarded grant", async () => {
  let opened = false;
  let stopped = false;
  await resolveViewRequest(
    Promise.resolve({ id: "signed-out-request" }),
    () => false,
    () => {
      opened = true;
    },
    async () => {
      stopped = true;
      throw new Error("authentication no longer available");
    },
  );
  assert.equal(stopped, true);
  assert.equal(opened, false);
});

test("current success/failure is delivered; an obsolete failure is ignored", async () => {
  const grant = { id: "current-request" };
  let opened: typeof grant | undefined;
  await resolveViewRequest(
    Promise.resolve(grant),
    () => true,
    (received) => {
      opened = received;
    },
    async () => assert.fail("current request must not be discarded"),
  );
  assert.equal(opened, grant);
  const failure = new Error("request failed");
  for (const current of [true, false]) {
    const result = resolveViewRequest(
      Promise.reject(failure),
      () => current,
      () => assert.fail("failure must not open a viewer"),
      async () => assert.fail("no grant exists to stop"),
    );
    if (current) await assert.rejects(result, (error) => error === failure);
    else await result;
  }
});
