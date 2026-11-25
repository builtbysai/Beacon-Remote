import assert from "node:assert/strict";
import { test } from "node:test";
import { inputLatency } from "../src/input-latency.js";

test("input RTT uses the original request and local monotonic clock", () => {
  let clock = 0;
  const sent: number[] = [],
    samples: (number | null)[] = [];
  const probe = inputLatency(
    () => clock,
    (id) => {
      sent.push(id);
      return true;
    },
    (n) => samples.push(n),
  );
  probe.tick(true);
  clock = 40;
  probe.tick(true);
  assert.equal(sent.length, 1);
  assert.equal(probe.receive(999), true);
  assert.deepEqual(samples, []);
  probe.receive(sent[0]);
  assert.deepEqual(samples, [40]);
  probe.receive(sent[0]);
  assert.deepEqual(samples, [40]);
});

test("older endpoints, paused work, stale replies and teardown never invent a healthy RTT", () => {
  let clock = 0;
  const sent: number[] = [],
    samples: (number | null)[] = [];
  const probe = inputLatency(
    () => clock,
    (id) => {
      sent.push(id);
      return true;
    },
    (n) => samples.push(n),
  );
  probe.tick(true);
  clock = 3100;
  probe.tick(true);
  assert.deepEqual(samples, [null]);
  probe.receive(sent[0]);
  assert.deepEqual(samples, [null]);
  probe.tick(true);
  assert.equal(sent.length, 2);
  probe.tick(false);
  probe.receive(sent[1]);
  assert.deepEqual(samples, [null, null]);
  probe.close();
  clock += 4000;
  probe.tick(true);
  assert.equal(sent.length, 2);
  assert.equal(probe.receive("1"), false);
  assert.equal(probe.receive(1.5), false);
});
