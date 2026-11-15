import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  SignInLease,
  SignInLeaseClock,
  type SignInLeaseIO,
} from "../src/signin-lease.js";

function fixture() {
  let wall = 1_000_000,
    monotonic = 100;
  const io = { wall: () => wall, monotonic: () => monotonic };
  return {
    io,
    anchor: () => ({ wall, monotonic }),
    advance(ms: number) {
      wall += ms;
      monotonic += ms;
    },
    rollback(ms: number) {
      wall -= ms;
    },
  };
}
function grant(expiresAtMillis: number) {
  return {
    id: randomUUID(),
    scope: "windows:sign-in",
    expiresAtMillis,
    connectable: false,
    files: false,
    clipboard: false,
    audio: false,
    recording: false,
    automation: false,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("HTTP delay and wall-clock rollback do not extend or revive a sign-in lease", () => {
  const f = fixture();
  const anchor = f.anchor(),
    expires = anchor.wall + 15_000;
  f.advance(4000);
  const clock = new SignInLeaseClock(expires, anchor, f.io);
  assert.equal(clock.live(), true);
  f.rollback(100_000);
  f.advance(11_000);
  assert.equal(clock.live(), false);
  assert.equal(clock.accept(f.io.wall() + 15_000, f.anchor()), false);

  const slow = fixture(),
    before = slow.anchor();
  slow.advance(16_000);
  assert.equal(
    new SignInLeaseClock(before.wall + 15_000, before, slow.io).live(),
    false,
  );
});

test("renewals retain the original absolute limit and cannot substitute an unlimited deadline", () => {
  const f = fixture();
  const clock = new SignInLeaseClock(f.io.wall() + 15_000, f.anchor(), f.io);
  for (let ms = 5000; ms < 300_000; ms += 5000) {
    f.advance(5000);
    assert.equal(clock.accept(f.io.wall() + 15_000, f.anchor()), true);
  }
  f.advance(5000);
  assert.equal(clock.live(), false);
  assert.equal(clock.accept(f.io.wall() + 15_000, f.anchor()), false);
  assert.equal(new SignInLeaseClock(0, f.anchor(), f.io).live(), false);
});

test("navigation cancellation disposes a delayed reservation without waiting for remote Stop", async () => {
  const f = fixture(),
    pending = deferred<unknown>();
  const abort = new AbortController();
  const paths: string[] = [],
    events: string[] = [];
  const io: SignInLeaseIO = {
    ...f.io,
    request: async (path) => {
      paths.push(path);
      if (path.endsWith("/signin-leases")) return pending.promise;
      events.push("remote-stop");
      throw new Error("offline");
    },
  };
  const reservation = SignInLease.reserve(
    randomUUID(),
    (reason) => events.push(reason),
    abort.signal,
    io,
  );
  abort.abort();
  const response = grant(f.io.wall() + 15_000);
  pending.resolve(response);
  await assert.rejects(reservation, /ended/);
  await Promise.resolve();
  assert.deepEqual(events, ["stopped", "remote-stop"]);
  assert.equal(paths[1], `signin/leases/${response.id}/stop`);
});

test("a blocked renewal cannot outlive expiry, overlap requests or revive after a late success", async () => {
  const f = fixture(),
    pending = deferred<unknown>();
  const paths: string[] = [],
    ended: string[] = [];
  let renewalSignal: AbortSignal | undefined;
  const io: SignInLeaseIO = {
    ...f.io,
    request: async (path, _body, signal) => {
      paths.push(path);
      if (path.endsWith("/signin-leases")) return grant(f.io.wall() + 15_000);
      if (path.endsWith("/renew")) {
        renewalSignal = signal;
        return pending.promise;
      }
      return { ok: true };
    },
  };
  const lease = await SignInLease.reserve(
    randomUUID(),
    (reason) => ended.push(reason),
    new AbortController().signal,
    io,
  );
  f.advance(5000);
  const renewal = lease.maintain();
  assert.equal(lease.maintain(), renewal);
  f.advance(10_000);
  assert.equal(lease.live(), false);
  assert.equal(renewalSignal?.aborted, true);
  pending.resolve({
    scope: "windows:sign-in",
    expiresAtMillis: f.io.wall() + 15_000,
  });
  await renewal;
  lease.stop();
  await lease.maintain();
  assert.equal(lease.live(), false);
  assert.deepEqual(ended, ["expired"]);
  assert.equal(paths.filter((path) => path.endsWith("/renew")).length, 1);
  assert.equal(paths.filter((path) => path.endsWith("/stop")).length, 1);
});

test("renewal metadata cannot widen scope or capabilities", async () => {
  for (const body of [
    { scope: "desktop:control", expiresAtMillis: 1_025_000 },
    { scope: "windows:sign-in", expiresAtMillis: 1_025_000, files: true },
    { scope: "windows:sign-in", expiresAtMillis: 0 },
  ]) {
    const f = fixture(),
      events: string[] = [];
    const io: SignInLeaseIO = {
      ...f.io,
      request: async (path) =>
        path.endsWith("/signin-leases") ? grant(f.io.wall() + 15_000) : body,
    };
    const lease = await SignInLease.reserve(
      randomUUID(),
      (reason) => events.push(reason),
      new AbortController().signal,
      io,
    );
    f.advance(5000);
    await lease.maintain();
    assert.equal(lease.live(), false);
    assert.deepEqual(events, ["unavailable"]);
  }
});

test("a malformed known reservation is stopped without exposing its response or activating a viewer", async () => {
  const f = fixture(),
    response = { ...grant(f.io.wall() + 15_000), files: true };
  const paths: string[] = [];
  const io: SignInLeaseIO = {
    ...f.io,
    request: async (path) => {
      paths.push(path);
      return response;
    },
  };
  await assert.rejects(
    SignInLease.reserve(
      randomUUID(),
      () => assert.fail("a rejected reservation cannot activate/end a viewer"),
      new AbortController().signal,
      io,
    ),
    /^Error: Invalid sign-in reservation$/,
  );
  await Promise.resolve();
  assert.equal(paths[1], `signin/leases/${response.id}/stop`);
});
