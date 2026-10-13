import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverTransport } from "../src/recover-transport.js";

test("transport recovery cannot replace or extend the original authorization", async () => {
  const original = { id: "original", expiresAtMillis: 1234 };
  let stopped = 0;
  const discard = async () => {
    stopped++;
  };
  assert.equal(
    await recoverTransport(
      original,
      async () => original,
      () => true,
      discard,
    ),
    original,
  );
  for (const replacement of [
    { ...original, id: "another" },
    { ...original, expiresAtMillis: 1235 },
  ]) {
    await assert.rejects(
      recoverTransport(
        original,
        async () => replacement,
        () => true,
        discard,
      ),
    );
  }
  assert.equal(stopped, 2);
});

test("Stop or expiry during a recovery response cannot open a replacement peer", async () => {
  const original = { id: "original", expiresAtMillis: 1234 };
  let settle!: () => void;
  const response = new Promise<typeof original>((resolve) => {
    settle = () => resolve(original);
  });
  let active = true;
  let stopped = false;
  const result = recoverTransport(
    original,
    () => response,
    () => active,
    async () => {
      stopped = true;
    },
  );
  active = false;
  settle();
  assert.equal(await result, null);
  assert.equal(stopped, true);
});
