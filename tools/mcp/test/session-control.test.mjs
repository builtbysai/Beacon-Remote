import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteSession } from "../src/session.mjs";

test("without an owner-granted control scope the session sends nothing", async () => {
  const session = new RemoteSession({
    origin: "https://example.test",
    list: async () => [],
    open: async () => ({}),
    stop: async () => {},
  });
  session.current = {
    deadline: Date.now() + 60_000,
    viewer: {
      evaluate: async () => {
        throw new Error("must not run");
      },
    },
  };
  assert.deepEqual(
    await session.control("pointer", { x: 1, y: 1 }, "ctl-00000001"),
    {
      ok: false,
      reason: "no-control-scope",
    },
  );
});

test("a scope is never granted when the owner has not granted control on the computer", async () => {
  const session = new RemoteSession({
    origin: "https://example.test",
    list: async () => [],
    open: async () => ({}),
    stop: async () => {},
  });
  const record = {
    deadline: Date.now() + 60_000,
    viewer: { evaluate: async () => ({ control: "none" }) },
  };
  session.current = record;
  assert.equal(await session.grantControlScope(record, "pc-1"), null);
  assert.equal(record.scope, undefined);
});
