import {
  signinViewerSignal,
  type SignInReady,
  type SignInContext,
} from "@beacon-remote/protocol";
import { SignInLease, type SignInEndReason } from "./signin-lease.js";
import type { SignInInputScope } from "./signin-input.js";

type Callbacks = {
  status: (message: string) => void;
  stream: (stream: MediaStream | null) => void;
  input: (channel: RTCDataChannel, scope: SignInInputScope) => () => void;
  ended: (reason: SignInEndReason) => void;
};
export type SignInConnectionPorts = {
  reserve: typeof SignInLease.reserve;
  socket: (url: string) => WebSocket;
  peer: (config: RTCConfiguration) => RTCPeerConnection;
  schedule: (callback: () => void) => () => void;
  origin: string;
};
const defaults = (): SignInConnectionPorts => ({
  reserve: SignInLease.reserve,
  socket: (url) => new WebSocket(url),
  peer: (config) => new RTCPeerConnection(config),
  schedule: (callback) => {
    const timer = setInterval(callback, 100);
    return () => clearInterval(timer);
  },
  origin: window.location.origin,
});
function iceConfiguration(ready: SignInReady): RTCConfiguration {
  let relay = false;
  for (const server of ready.iceServers) {
    const stun = server.urls.every((url) => url.startsWith("stun:"));
    const turn = server.urls.every(
      (url) => url.startsWith("turn:") || url.startsWith("turns:"),
    );
    if (stun) {
      if (server.username !== undefined || server.credential !== undefined)
        throw new Error();
    } else if (turn) {
      const split = server.username?.split(":");
      const expires = Number(split?.[0]);
      if (
        !server.credential ||
        split?.slice(1).join(":") !== `beacon-remote:${ready.leaseId}` ||
        !Number.isSafeInteger(expires) ||
        expires * 1000 <= Date.now() ||
        expires * 1000 > Date.now() + 331_000
      )
        throw new Error();
      relay = true;
    } else throw new Error();
  }
  if (ready.iceTransportPolicy === "relay" && !relay) throw new Error();
  return {
    iceServers: ready.iceServers,
    iceTransportPolicy: ready.iceTransportPolicy,
    bundlePolicy: "max-bundle",
  };
}
export class SignInConnection {
  private ended = false;
  private readonly abort = new AbortController();
  private socket?: WebSocket;
  private peer?: RTCPeerConnection;
  private ready?: SignInReady;
  private paired = false;
  private offered = false;
  private answered = false;
  private candidates: RTCIceCandidateInit[] = [];
  private channel?: RTCDataChannel;
  private disposeInput?: () => void;
  private track?: MediaStreamTrack;
  private serial = Promise.resolve();
  private pending = 0;
  private bytes = 0;
  private frames = 0;
  private frameStart = performance.now();
  private readonly started = performance.now();
  private cancelTimer?: () => void;
  private constructor(
    private readonly lease: SignInLease,
    private readonly callbacks: Callbacks,
    private readonly ports: SignInConnectionPorts,
  ) {}
  static async start(
    machine: string,
    callbacks: Callbacks,
    signal: AbortSignal,
    ports = defaults(),
  ): Promise<SignInConnection> {
    const current: { connection?: SignInConnection } = {};
    const lease = await ports.reserve(
      machine,
      (reason) => current.connection?.end(reason),
      signal,
    );
    const connection = new SignInConnection(lease, callbacks, ports);
    current.connection = connection;
    if (signal.aborted || !lease.live() || !lease.grant.connectable) {
      connection.end("unavailable");
      lease.stop();
      throw new Error("Windows sign-in is unavailable");
    }
    try {
      connection.open();
      return connection;
    } catch {
      connection.end("unavailable");
      lease.stop();
      throw new Error("Could not open Windows sign-in");
    }
  }
  private live() {
    return !this.ended && this.lease.live();
  }
  canInput() {
    return (
      this.live() &&
      this.peer?.connectionState === "connected" &&
      this.answered &&
      this.socket?.readyState === 1
    );
  }
  private open() {
    const url = new URL(
      `/api/signin/leases/${this.lease.grant.id}/signal`,
      this.ports.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("role", "viewer");
    const socket = this.ports.socket(url.href);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (!this.live()) return;
      const size =
        typeof event.data === "string"
          ? new TextEncoder().encode(event.data).length
          : Infinity;
      if (size > 65536 || this.pending >= 16 || this.bytes + size > 131072) {
        this.end("unavailable");
        return;
      }
      if (performance.now() - this.frameStart >= 60_000) {
        this.frameStart = performance.now();
        this.frames = 0;
      }
      if (++this.frames > 256) {
        this.end("unavailable");
        return;
      }
      this.pending++;
      this.bytes += size;
      this.serial = this.serial
        .then(() => this.message(event.data))
        .catch(() => this.end("unavailable"))
        .finally(() => {
          this.pending--;
          this.bytes -= size;
        });
    };
    socket.onclose = () => this.end("unavailable");
    socket.onerror = () => this.end("unavailable");
    this.cancelTimer = this.ports.schedule(() => {
      if (!this.live()) return;
      void this.lease.maintain().catch(() => this.end("unavailable"));
      if (
        this.peer?.connectionState !== "connected" &&
        performance.now() - this.started >= 10_000
      )
        this.end("unavailable");
    });
    this.callbacks.status("Connecting to Windows sign-in…");
  }
  private send(message: unknown) {
    if (
      !this.live() ||
      this.socket?.readyState !== 1 ||
      this.socket.bufferedAmount > 131072
    )
      throw new Error();
    const body = JSON.stringify(message);
    if (new TextEncoder().encode(body).length > 65536) throw new Error();
    this.socket.send(body);
  }
  private async checked<T>(operation: Promise<T>): Promise<T> {
    if (!this.live()) throw new Error();
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(2000),
    ]);
    signal.throwIfAborted();
    let rejectAbort: () => void = () => {};
    try {
      const stopped = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error());
        signal.addEventListener("abort", rejectAbort, { once: true });
      });
      const value = await Promise.race([operation, stopped]);
      if (signal.aborted || !this.live()) throw new Error();
      return value;
    } finally {
      signal.removeEventListener("abort", rejectAbort);
    }
  }
  private async message(raw: string) {
    if (!this.live()) return;
    const parsed = signinViewerSignal.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error();
    const message = parsed.data;
    if (message.type === "ready") {
      if (this.ready || message.leaseId !== this.lease.grant.id)
        throw new Error();
      this.ready = message;
      this.peer = this.ports.peer(iceConfiguration(message));
      const peer = this.peer;
      peer.onconnectionstatechange = () => {
        if (!this.live()) return;
        if (
          ["disconnected", "failed", "closed"].includes(peer.connectionState)
        ) {
          this.end("unavailable");
          return;
        }
        if (peer.connectionState === "connected") {
          this.publish();
          this.callbacks.status("Windows sign-in");
        }
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate || !this.live()) return;
        try {
          const candidate = event.candidate.toJSON();
          this.send({
            type: "candidate",
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          });
        } catch {
          this.end("unavailable");
        }
      };
      peer.ontrack = (event) => {
        if (!this.live()) return;
        if (event.track.kind !== "video" || this.track) {
          this.end("unavailable");
          return;
        }
        this.track = event.track;
        event.track.onended = () => this.end("unavailable");
        this.publish();
      };
      peer.ondatachannel = (event) => {
        const channel = event.channel;
        if (
          !this.live() ||
          this.channel ||
          channel.label !== "beacon-signin-input-v1" ||
          !channel.ordered ||
          channel.maxPacketLifeTime !== null ||
          channel.maxRetransmits !== null ||
          channel.protocol !== ""
        ) {
          channel.close();
          this.end("unavailable");
          return;
        }
        this.channel = channel;
        const binding: SignInContext = {
          leaseId: message.leaseId,
          instanceId: message.instanceId,
          consoleSessionId: message.consoleSessionId,
        };
        try {
          this.disposeInput = this.callbacks.input(channel, {
            ...binding,
            live: () => this.canInput(),
          });
        } catch {
          this.end("unavailable");
        }
      };
    } else if (message.type === "peer-ready") {
      if (!this.ready || this.paired) throw new Error();
      this.paired = true;
    } else if (message.type === "offer") {
      if (!this.peer || !this.paired || this.offered) throw new Error();
      this.offered = true;
      const peer = this.peer;
      await this.checked(
        peer.setRemoteDescription({ type: "offer", sdp: message.sdp }),
      );
      for (const candidate of this.candidates.splice(0))
        await this.checked(peer.addIceCandidate(candidate));
      const answer = await this.checked(peer.createAnswer());
      await this.checked(peer.setLocalDescription(answer));
      if (!answer.sdp || answer.sdp.length > 32768) throw new Error();
      this.send({ type: "answer", sdp: answer.sdp });
      this.answered = true;
      this.publish();
    } else {
      if (!this.peer || !this.paired) throw new Error();
      if (!message.candidate) return;
      const candidate = {
        candidate: message.candidate,
        sdpMid: message.sdpMid ?? null,
        sdpMLineIndex: message.sdpMLineIndex ?? null,
      };
      if (this.peer.remoteDescription)
        await this.checked(this.peer.addIceCandidate(candidate));
      else {
        if (this.candidates.length >= 16) throw new Error();
        this.candidates.push(candidate);
      }
    }
  }
  private publish() {
    if (this.canInput() && this.track)
      this.callbacks.stream(new MediaStream([this.track]));
  }
  stop() {
    this.lease.stop();
    this.end("stopped");
  }
  handoffContext(): SignInContext | null {
    return this.ready
      ? {
          leaseId: this.ready.leaseId,
          instanceId: this.ready.instanceId,
          consoleSessionId: this.ready.consoleSessionId,
        }
      : null;
  }
  transfer() {
    this.lease.transfer();
  }
  fail() {
    this.end("unavailable");
  }
  private end(reason: SignInEndReason) {
    if (this.ended) return;
    this.ended = true;
    this.abort.abort();
    this.cancelTimer?.();
    if (reason === "unavailable") this.lease.suspend();
    else this.lease.stop();
    this.candidates = [];
    // One failed observer/disposer must not keep another transport alive.
    for (const cleanup of [
      () => this.disposeInput?.(),
      () => this.channel?.close(),
      () => this.track?.stop(),
      () => this.peer?.close(),
      () => this.socket?.close(),
      () => this.callbacks.stream(null),
      () => this.callbacks.ended(reason),
    ]) {
      try {
        cleanup();
      } catch {
        /* Authority is already ended; continue resource teardown. */
      }
    }
  }
}
