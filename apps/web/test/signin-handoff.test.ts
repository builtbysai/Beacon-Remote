import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { handoffDesktop, type HandoffIO } from "../src/signin-handoff.js";
function fixture() {
  const machine = randomUUID(),
    scope = {
      leaseId: randomUUID(),
      instanceId: randomUUID(),
      consoleSessionId: 3,
    };
  const ready = {
    state: "ready",
    ...scope,
    machineId: machine,
    hostContext: { instanceId: randomUUID(), consoleSessionId: 3 },
  };
  const grant = {
    id: randomUUID(),
    source: "desktop",
    capability: "desktop:control",
    approval: "policy",
    expiresAtMillis: 0,
    iceServers: [],
    iceTransportPolicy: "all",
  };
  let now = 0;
  const requests: { path: string; body: unknown }[] = [];
  const io: HandoffIO = {
    now: () => now,
    wait: async () => {
      now += 500;
    },
    request: async (path, body) => {
      requests.push({ path, body });
      return path.endsWith("/handoff")
        ? ready
        : path.endsWith("/sessions")
          ? grant
          : { ok: true };
    },
  };
  return {
    machine,
    scope,
    ready,
    grant,
    requests,
    io,
    advance: (value: number) => {
      now = value;
    },
  };
}
test("handoff asks for a fresh policy grant pinned to the verified host and sign-in intent", async () => {
  const f = fixture();
  let pending = true;
  const request = f.io.request;
  f.io.request = async (path, body, signal) => {
    if (path.endsWith("/handoff") && pending) {
      pending = false;
      return { state: "pending" };
    }
    return request(path, body, signal);
  };
  const grant = await handoffDesktop(
    f.machine,
    f.scope,
    new AbortController().signal,
    () => {},
    f.io,
  );
  assert.equal(grant.id, f.grant.id);
  assert.deepEqual(f.requests.at(-1)?.body, {
    source: "desktop",
    capability: "desktop:control",
    requirePolicy: true,
    hostContext: f.ready.hostContext,
    signinLeaseId: f.scope.leaseId,
  });
  assert.ok(!f.requests.some((entry) => entry.path.endsWith("/stop")));
});
test("wrong context, local-approval substitution and timeout cannot become a desktop connection", async () => {
  for (const mode of ["console", "worker", "approval", "timeout"]) {
    const f = fixture();
    const request = f.io.request;
    f.io.request = async (path, body, signal) => {
      if (path.endsWith("/handoff")) {
        if (mode === "console") return { ...f.ready, consoleSessionId: 4 };
        if (mode === "worker") return { ...f.ready, instanceId: randomUUID() };
        if (mode === "timeout") {
          f.advance(30000);
          return { state: "pending" };
        }
      }
      if (mode === "approval" && path.endsWith("/sessions")) {
        f.requests.push({ path, body });
        return { ...f.grant, approval: "local" };
      }
      return request(path, body, signal);
    };
    await assert.rejects(
      handoffDesktop(
        f.machine,
        f.scope,
        new AbortController().signal,
        () => {},
        f.io,
      ),
    );
    assert.ok(
      f.requests.some(
        (entry) => entry.path === `signin/leases/${f.scope.leaseId}/stop`,
      ),
      mode,
    );
    if (mode === "approval")
      assert.ok(
        f.requests.some(
          (entry) => entry.path === `sessions/${f.grant.id}/stop`,
        ),
      );
    else
      assert.ok(!f.requests.some((entry) => entry.path.endsWith("/sessions")));
  }
});
test("Stop while ordinary admission is delayed disposes the late grant with independent cleanup signals", async () => {
  const f = fixture(),
    abort = new AbortController();
  let resolve: (value: unknown) => void = () => {};
  let entered = () => {};
  const waiting = new Promise<void>((done) => {
    entered = done;
  });
  const pending = new Promise<unknown>((done) => {
    resolve = done;
  });
  const request = f.io.request;
  f.io.request = async (path, body, signal) => {
    if (path.endsWith("/sessions")) {
      entered();
      return pending;
    }
    assert.equal(signal.aborted, false);
    return request(path, body, signal);
  };
  const transfer = handoffDesktop(
    f.machine,
    f.scope,
    abort.signal,
    () => {},
    f.io,
  );
  await waiting;
  abort.abort();
  resolve(f.grant);
  await assert.rejects(transfer);
  assert.ok(
    f.requests.some(
      (entry) => entry.path === `signin/leases/${f.scope.leaseId}/stop`,
    ),
  );
  assert.ok(
    f.requests.some((entry) => entry.path === `sessions/${f.grant.id}/stop`),
  );
});
