import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  SignInConnection,
  type SignInConnectionPorts,
} from "../src/signin-connection.js";
import { SignInLease } from "../src/signin-lease.js";
import type { SignInInputScope } from "../src/signin-input.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
class Socket {
  readyState = 1;
  bufferedAmount = 0;
  closed = 0;
  sent: Record<string, unknown>[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(body: string) {
    this.sent.push(JSON.parse(body));
  }
  close() {
    this.closed++;
    this.readyState = 3;
    this.onclose?.();
  }
  receive(body: unknown) {
    this.onmessage?.({ data: JSON.stringify(body) });
  }
}
class Peer {
  connectionState = "new";
  closed = 0;
  localCalls = 0;
  answerCalls = 0;
  remoteDescription: unknown = null;
  remoteGate?: Promise<void>;
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((event: unknown) => void) | null = null;
  ontrack: ((event: unknown) => void) | null = null;
  ondatachannel: ((event: { channel: unknown }) => void) | null = null;
  async setRemoteDescription(description: unknown) {
    await this.remoteGate;
    this.remoteDescription = description;
  }
  async createAnswer() {
    this.answerCalls++;
    return { type: "answer", sdp: "synthetic-answer" };
  }
  async setLocalDescription() {
    this.localCalls++;
  }
  async addIceCandidate() {}
  close() {
    this.closed++;
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }
  state(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}
function fixture(connectable = true) {
  const id = randomUUID(),
    instanceId = randomUUID(),
    socket = new Socket(),
    peer = new Peer();
  const requests: string[] = [],
    ended: string[] = [],
    urls: string[] = [];
  let peers = 0,
    disposed = 0,
    scope: SignInInputScope | undefined;
  let tick = () => {};
  let wall = Date.now(),
    mono = performance.now();
  const ready = {
    type: "ready",
    scope: "windows:sign-in",
    leaseId: id,
    instanceId,
    consoleSessionId: 1,
    workerPublicKey: randomBytes(32).toString("base64"),
    iceServers: [{ urls: ["stun:127.0.0.1:3478"] }],
    iceTransportPolicy: "all",
    files: false,
    clipboard: false,
    audio: false,
    recording: false,
    automation: false,
  };
  const ports: SignInConnectionPorts = {
    reserve: (machine, onEnd, signal) =>
      SignInLease.reserve(machine, onEnd, signal, {
        wall: () => wall,
        monotonic: () => mono,
        request: async (path) => {
          requests.push(path);
          return path.endsWith("/signin-leases")
            ? {
                id,
                scope: "windows:sign-in",
                expiresAtMillis: wall + 15_000,
                connectable,
                files: false,
                clipboard: false,
                audio: false,
                recording: false,
                automation: false,
              }
            : path.endsWith("/renew")
              ? { scope: "windows:sign-in", expiresAtMillis: wall + 15_000 }
              : { ok: true };
        },
      }),
    socket: (url) => {
      urls.push(url);
      return socket as unknown as WebSocket;
    },
    peer: () => {
      peers++;
      return peer as unknown as RTCPeerConnection;
    },
    schedule: (run) => {
      tick = run;
      return () => {
        tick = () => {};
      };
    },
    origin: "https://remote.example",
  };
  const callbacks = {
    status: () => {},
    stream: () => {},
    input: (_channel: RTCDataChannel, context: SignInInputScope) => {
      scope = context;
      return () => {
        disposed++;
      };
    },
    ended: (reason: string) => ended.push(reason),
  };
  return {
    id,
    ready,
    socket,
    peer,
    ports,
    callbacks,
    requests,
    ended,
    urls,
    get peers() {
      return peers;
    },
    get scope() {
      return scope;
    },
    get disposed() {
      return disposed;
    },
    tick: () => tick(),
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
  };
}
async function pair(f: ReturnType<typeof fixture>) {
  f.socket.receive(f.ready);
  f.socket.receive({ type: "peer-ready", scope: "windows:sign-in" });
  f.socket.receive({ type: "offer", sdp: "synthetic-offer" });
  await flush();
}
function inputChannel(label = "beacon-signin-input-v1") {
  return {
    label,
    ordered: true,
    maxPacketLifeTime: null,
    maxRetransmits: null,
    protocol: "",
    closed: 0,
    close() {
      this.closed++;
    },
  };
}

test("scoped negotiation answers the worker and admits only the connected dedicated input lane", async () => {
  const f = fixture();
  const connection = await SignInConnection.start(
    randomUUID(),
    f.callbacks,
    new AbortController().signal,
    f.ports,
  );
  assert.equal(
    f.urls[0],
    `wss://remote.example/api/signin/leases/${f.id}/signal?role=viewer`,
  );
  assert.equal(connection.canInput(), false);
  await pair(f);
  assert.equal(f.peers, 1);
  assert.deepEqual(f.socket.sent, [
    { type: "answer", sdp: "synthetic-answer" },
  ]);
  f.peer.state("connected");
  const channel = inputChannel();
  f.peer.ondatachannel?.({ channel });
  assert.equal(connection.canInput(), true);
  assert.equal(f.scope?.live(), true);
  f.peer.state("disconnected");
  assert.equal(connection.canInput(), false);
  assert.equal(f.scope?.live(), false);
  assert.equal(f.disposed, 1);
  assert.equal(channel.closed, 1);
  assert.equal(f.peer.closed, 1);
  assert.equal(f.socket.closed, 1);
  f.peer.state("connected");
  assert.equal(connection.canInput(), false);
  await flush();
  assert.equal(
    f.requests.filter((path) => path.endsWith("/stop")).length,
    0,
    "transport loss leaves only a bounded backend-verified handoff opportunity",
  );
  connection.stop();
  await flush();
  assert.equal(f.requests.filter((path) => path.endsWith("/stop")).length, 1);
  assert.deepEqual(f.ended, ["unavailable"]);
});

test("unavailable reservations never open a socket or peer", async () => {
  const f = fixture(false);
  await assert.rejects(
    SignInConnection.start(
      randomUUID(),
      f.callbacks,
      new AbortController().signal,
      f.ports,
    ),
    /unavailable/,
  );
  assert.equal(f.urls.length, 0);
  assert.equal(f.peers, 0);
  await flush();
  assert.equal(f.requests.filter((path) => path.endsWith("/stop")).length, 1);
});

test("wrong lease, widened capabilities, duplicate readiness and unrelated channels end the connection", async () => {
  for (const invalid of ["lease", "capability", "duplicate", "channel"]) {
    const f = fixture();
    const connection = await SignInConnection.start(
      randomUUID(),
      f.callbacks,
      new AbortController().signal,
      f.ports,
    );
    if (invalid === "lease")
      f.socket.receive({ ...f.ready, leaseId: randomUUID() });
    else if (invalid === "capability")
      f.socket.receive({ ...f.ready, clipboard: true });
    else {
      await pair(f);
      if (invalid === "duplicate") f.socket.receive(f.ready);
      else {
        const channel = inputChannel("beacon-files-v1");
        f.peer.ondatachannel?.({ channel });
        assert.equal(channel.closed, 1);
      }
    }
    await flush();
    assert.equal(connection.canInput(), false);
    assert.deepEqual(f.ended, ["unavailable"]);
    assert.equal(f.socket.closed, 1);
    connection.stop();
    assert.equal(f.ended.length, 1);
  }
});

test("Stop cancels a blocked SDP operation and its late success cannot emit an answer", async () => {
  const f = fixture();
  let release!: () => void;
  f.peer.remoteGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const connection = await SignInConnection.start(
    randomUUID(),
    f.callbacks,
    new AbortController().signal,
    f.ports,
  );
  await pair(f);
  connection.stop();
  release();
  await flush();
  assert.equal(f.peer.answerCalls, 0);
  assert.equal(f.peer.localCalls, 0);
  assert.equal(f.socket.sent.length, 0);
  assert.equal(f.peer.closed, 1);
  assert.deepEqual(f.ended, ["stopped"]);
});

test("the short lifecycle timer ends expired access independently of incoming signaling", async () => {
  const f = fixture();
  const connection = await SignInConnection.start(
    randomUUID(),
    f.callbacks,
    new AbortController().signal,
    f.ports,
  );
  await pair(f);
  f.peer.state("connected");
  f.advance(15_000);
  f.tick();
  await flush();
  assert.equal(connection.canInput(), false);
  assert.equal(f.peer.closed, 1);
  assert.deepEqual(f.ended, ["expired"]);
});

test("a stalled SDP handler cannot accumulate an unbounded signaling queue", async () => {
  const f = fixture();
  let release!: () => void;
  f.peer.remoteGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const connection = await SignInConnection.start(
    randomUUID(),
    f.callbacks,
    new AbortController().signal,
    f.ports,
  );
  await pair(f);
  for (let n = 0; n < 17; n++)
    f.socket.receive({
      type: "candidate",
      candidate: `candidate:${n}`,
      sdpMid: "0",
      sdpMLineIndex: 0,
    });
  assert.equal(f.socket.closed, 1);
  assert.equal(connection.canInput(), false);
  release();
  await flush();
  assert.equal(f.socket.sent.length, 0);
  assert.deepEqual(f.ended, ["unavailable"]);
});

test("a throwing input disposer or UI observer cannot strand peer or signaling resources", async () => {
  const f = fixture();
  f.callbacks.input = () => () => {
    throw new Error("synthetic disposer failure");
  };
  f.callbacks.stream = () => {
    throw new Error("synthetic observer failure");
  };
  const connection = await SignInConnection.start(
    randomUUID(),
    f.callbacks,
    new AbortController().signal,
    f.ports,
  );
  await pair(f);
  f.peer.state("connected");
  const channel = inputChannel();
  f.peer.ondatachannel?.({ channel });
  assert.doesNotThrow(() => connection.stop());
  assert.equal(channel.closed, 1);
  assert.equal(f.peer.closed, 1);
  assert.equal(f.socket.closed, 1);
  assert.deepEqual(f.ended, ["stopped"]);
});
