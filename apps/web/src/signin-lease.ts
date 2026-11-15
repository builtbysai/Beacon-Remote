import {
  signinLeaseReservation,
  signinLeaseRenewal,
  type SignInLeaseReservation,
} from "@beacon-remote/protocol";
import { api } from "./api.js";

export type SignInEndReason = "stopped" | "expired" | "unavailable";
type Anchor = { wall: number; monotonic: number };
export type SignInLeaseIO = {
  request: (
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  wall: () => number;
  monotonic: () => number;
};
const defaults: SignInLeaseIO = {
  request: (path, body, signal) => api(path, body, signal),
  wall: () => Date.now(),
  monotonic: () => performance.now(),
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stopRemote(io: SignInLeaseIO, id: string) {
  void Promise.resolve()
    .then(() =>
      io.request(`signin/leases/${id}/stop`, {}, AbortSignal.timeout(3000)),
    )
    .catch(() => {});
}

// Local expiry never replaces server/native authorization. Anchor before HTTP,
// so request latency consumes the same lease; wall-clock rollback cannot extend
// it and no renewal can revive an ended lease or exceed its original five minutes.
export class SignInLeaseClock {
  private ended = false;
  private deadline = 0;
  private expires = 0;
  private readonly absolute: number;
  private readonly absoluteWall: number;
  constructor(
    expires: number,
    private readonly issued: Anchor,
    private readonly io: Pick<SignInLeaseIO, "wall" | "monotonic">,
  ) {
    this.issued = { ...issued };
    this.absolute = issued.monotonic + 300_000;
    this.absoluteWall = issued.wall + 300_000;
    this.accept(expires, issued);
  }
  accept(expires: number, anchor: Anchor): boolean {
    if (
      this.ended ||
      (this.deadline !== 0 && !this.live()) ||
      !Number.isSafeInteger(expires) ||
      expires <= 0 ||
      !Number.isFinite(anchor.wall) ||
      !Number.isFinite(anchor.monotonic) ||
      anchor.monotonic < this.issued.monotonic ||
      anchor.monotonic > this.io.monotonic()
    ) {
      this.stop();
      return false;
    }
    this.deadline = Math.min(
      this.absolute,
      anchor.monotonic + Math.min(15_000, Math.max(0, expires - anchor.wall)),
    );
    this.expires = expires;
    return this.live();
  }
  live(): boolean {
    if (this.ended) return false;
    const monotonic = this.io.monotonic(),
      wall = this.io.wall();
    if (
      !Number.isFinite(monotonic) ||
      !Number.isFinite(wall) ||
      monotonic < this.issued.monotonic ||
      monotonic >= this.deadline ||
      wall >= this.expires ||
      wall >= this.absoluteWall
    )
      this.stop();
    return !this.ended;
  }
  stop() {
    this.ended = true;
  }
}

export class SignInLease {
  readonly grant: Readonly<SignInLeaseReservation>;
  private readonly clock: SignInLeaseClock;
  private readonly abort = new AbortController();
  private ended = false;
  private pending?: Promise<void>;
  private renewAt: number;
  private transferred = false;
  private remoteStopped = false;
  private constructor(
    grant: SignInLeaseReservation,
    anchor: Anchor,
    private readonly io: SignInLeaseIO,
    private readonly onEnd: (reason: SignInEndReason) => void,
  ) {
    this.grant = Object.freeze(grant);
    this.clock = new SignInLeaseClock(grant.expiresAtMillis, anchor, io);
    this.renewAt = anchor.monotonic + 5000;
  }
  static async reserve(
    machine: string,
    onEnd: (reason: SignInEndReason) => void,
    signal: AbortSignal,
    io: SignInLeaseIO = defaults,
  ): Promise<SignInLease> {
    if (!uuid.test(machine)) throw new Error("Invalid computer");
    signal.throwIfAborted();
    const anchor = { wall: io.wall(), monotonic: io.monotonic() };
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
    const raw = await io.request(
      `machines/${machine}/signin-leases`,
      {},
      requestSignal,
    );
    const parsed = signinLeaseReservation.safeParse(raw);
    if (!parsed.success) {
      if (
        raw &&
        typeof raw === "object" &&
        "id" in raw &&
        typeof raw.id === "string" &&
        uuid.test(raw.id)
      )
        stopRemote(io, raw.id);
      throw new Error("Invalid sign-in reservation");
    }
    const grant = parsed.data;
    const lease = new SignInLease(grant, anchor, io, onEnd);
    signal.addEventListener("abort", () => lease.stop(), {
      once: true,
      signal: lease.abort.signal,
    });
    if (requestSignal.aborted)
      lease.end(signal.aborted ? "stopped" : "unavailable");
    if (!lease.live()) throw new Error("Sign-in lease ended before connection");
    return lease;
  }
  live(): boolean {
    if (!this.ended && !this.clock.live()) this.end("expired");
    return !this.ended;
  }
  // The viewer's short timer calls maintain, independently of signaling/media
  // traffic. It may also call live before every async result or input send.
  maintain(): Promise<void> {
    if (!this.live() || this.io.monotonic() < this.renewAt)
      return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.renew().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async renew() {
    const anchor = { wall: this.io.wall(), monotonic: this.io.monotonic() };
    try {
      const requestSignal = AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(3000),
      ]);
      const raw = await this.io.request(
        `signin/leases/${this.grant.id}/renew`,
        {},
        requestSignal,
      );
      if (!this.live()) return;
      if (requestSignal.aborted) {
        this.end("unavailable");
        return;
      }
      const renewed = signinLeaseRenewal.parse(raw);
      if (!this.clock.accept(renewed.expiresAtMillis, anchor)) {
        this.end("expired");
        return;
      }
      this.renewAt = anchor.monotonic + 5000;
    } catch {
      this.end("unavailable");
    }
  }
  stop() {
    this.end("stopped");
    if (!this.transferred && !this.remoteStopped) {
      this.remoteStopped = true;
      stopRemote(this.io, this.grant.id);
    }
  }
  suspend() {
    this.end("unavailable");
  }
  transfer() {
    this.transferred = true;
  }
  private end(reason: SignInEndReason) {
    if (this.ended) return;
    this.ended = true;
    this.clock.stop();
    this.abort.abort();
    // Local viewer/input teardown must run before any network wait. A failed
    // Stop POST cannot restore local authority; server/native expiry remains.
    try {
      this.onEnd(reason);
    } finally {
      if (
        reason !== "unavailable" &&
        !this.transferred &&
        !this.remoteStopped
      ) {
        this.remoteStopped = true;
        stopRemote(this.io, this.grant.id);
      }
    }
  }
}
