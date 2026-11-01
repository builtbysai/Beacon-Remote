import assert from "node:assert/strict";
import { test } from "node:test";
import type { Machine } from "@beacon-remote/protocol";
import { ApiError } from "../src/api.js";
import { waitForRestart } from "../src/restart-reconnect.js";

const machine: Machine = {
  id: "computer",
  name: "Office PC",
  group: null,
  online: true,
  hostInstanceId: "old-host",
  lastSeenAt: null,
  revokedAt: null,
  accessMode: "trusted",
  allowControl: true,
  helpersUnattended: "off",
  displays: [],
};
const base = {
  machineId: machine.id,
  previousInstance: machine.hostInstanceId!,
  capability: "desktop:control" as const,
  isCurrent: () => true,
};

test("fast restart waits for a new host instead of connecting to stale online presence", async () => {
  let polls = 0,
    waits = 0;
  const result = await waitForRestart({
    ...base,
    observe: async () => [
      ++polls < 3 ? machine : { ...machine, hostInstanceId: "new-host" },
    ],
    sleep: async () => {
      waits++;
    },
  });
  assert.equal(result?.hostInstanceId, "new-host");
  assert.equal(waits, 2);
});

test("older hosts need an offline/online transition and locked hosts remain unavailable", async () => {
  const states = [
    machine,
    { ...machine, online: false, bootState: "locked" as const },
    { ...machine, online: false },
    machine,
  ];
  let polls = 0;
  const ready = await waitForRestart({
    ...base,
    previousInstance: null,
    observe: async () => [states[polls++]!],
    sleep: async () => {},
  });
  assert.equal(ready, machine);
  assert.equal(polls, 4);
});

test("revocation, removal and policy lowering stop automatic reconnection", async () => {
  for (const observed of [
    [],
    [{ ...machine, revokedAt: "revoked" }],
    [{ ...machine, uninstallPending: true }],
    [{ ...machine, accessMode: "attended" as const }],
    [{ ...machine, allowControl: false }],
  ]) {
    await assert.rejects(
      waitForRestart({ ...base, observe: async () => observed }),
      /Reconnect stopped/,
    );
  }
});

test("network outages retry but expired browser authority is final", async () => {
  let polls = 0;
  const ready = await waitForRestart({
    ...base,
    observe: async () => {
      polls++;
      if (polls === 1) throw new TypeError("network unavailable");
      if (polls === 2) throw new ApiError(503);
      return [{ ...machine, hostInstanceId: "new-host" }];
    },
    sleep: async () => {},
  });
  assert.equal(ready?.hostInstanceId, "new-host");
  await assert.rejects(
    waitForRestart({
      ...base,
      observe: async () => {
        throw new ApiError(401);
      },
    }),
    ApiError,
  );
});

test("cancellation discards late observations and the wait has a monotonic deadline", async () => {
  let active = true;
  const cancelled = await waitForRestart({
    ...base,
    isCurrent: () => active,
    observe: async () => {
      active = false;
      return [{ ...machine, hostInstanceId: "new-host" }];
    },
  });
  assert.equal(cancelled, null);
  let clock = 0;
  await assert.rejects(
    waitForRestart({
      ...base,
      now: () => clock,
      windowMs: 10000,
      observe: async () => [machine],
      sleep: async (ms) => {
        clock += ms;
      },
    }),
    /timed out/,
  );
  clock = 0;
  await assert.rejects(
    waitForRestart({
      ...base,
      now: () => clock,
      windowMs: 10000,
      observe: async () => {
        clock += 10001;
        return [{ ...machine, hostInstanceId: "late-host" }];
      },
    }),
    /timed out/,
  );
});
