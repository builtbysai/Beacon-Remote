import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { Sha256 } from "../src/file-transfer.js";

test("incremental SHA-256 matches the platform hash for every padding boundary and chunking", () => {
  for (const length of [
    0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 100_003,
  ]) {
    const data = randomBytes(length);
    const expected = createHash("sha256").update(data).digest("hex");
    for (const step of [1, 7, 16384, 99_999]) {
      const hash = new Sha256();
      for (let offset = 0; offset < data.length; offset += step)
        hash.update(data.subarray(offset, offset + step));
      assert.equal(hash.hex(), expected, `${length} bytes in steps of ${step}`);
    }
  }
});

test("reading the digest does not disturb a hash that keeps going", () => {
  const first = randomBytes(100);
  const second = randomBytes(77);
  const hash = new Sha256().update(first);
  hash.hex();
  hash.update(second);
  assert.equal(
    hash.hex(),
    createHash("sha256").update(first).update(second).digest("hex"),
  );
});

// A stand-in for the browser's RTCDataChannel: records what is sent and lets the test deliver messages.
function fakeChannel() {
  const sent: (string | Uint8Array)[] = [];
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    binaryType: "blob",
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onclose: null as (() => void) | null,
    onbufferedamountlow: null as (() => void) | null,
    send: (data: string | Uint8Array) => void sent.push(data),
  };
  return { channel: channel as unknown as RTCDataChannel, raw: channel, sent };
}
const frame = (id: number, bytes: Uint8Array) => {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, id);
  out.set(bytes, 4);
  return out.buffer;
};

test("a file the computer offers is received only after the person accepts, and only if it arrives intact", async () => {
  const { FileSender } = await import("../src/file-transfer.js");
  const downloads: string[] = [];
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => {
      const element = {
        download: "",
        href: "",
        click() {
          downloads.push(element.download);
        },
      };
      return element;
    },
  };
  const offers: unknown[] = [];
  const transfers: { status: string; incoming?: boolean }[] = [];
  const { channel, raw, sent } = fakeChannel();
  const sender = new FileSender(
    channel,
    (t) => t && transfers.push(t),
    () => undefined,
    (offer) => offers.push(offer),
  );
  const deliver = (data: unknown) => raw.onmessage!({ data });

  // The computer's ids are even; an odd or malformed offer is ignored.
  deliver(JSON.stringify({ t: "send", id: 3, name: "x", size: 5 }));
  deliver(JSON.stringify({ t: "send", id: 2, name: "", size: 5 }));
  assert.equal(offers.length, 0);
  deliver(JSON.stringify({ t: "send", id: 2, name: "log.txt", size: 11 }));
  assert.equal(offers.length, 1);
  assert.equal(sent.length, 0, "nothing is accepted until the person says so");

  sender.accept({ id: 2, name: "log.txt", size: 11 });
  assert.deepEqual(JSON.parse(sent[0] as string), { t: "accept", id: 2 });
  const data = new TextEncoder().encode("hello world");
  deliver(frame(9, data)); // someone else's id: ignored
  deliver(frame(2, data));
  const good = new Sha256().update(data).hex();

  // A wrong checksum is discarded and reported, nothing is saved.
  const bad = fakeChannel();
  const second = new FileSender(
    bad.channel,
    () => undefined,
    () => undefined,
    () => undefined,
  );
  second.accept({ id: 4, name: "bad.txt", size: 11 });
  bad.raw.onmessage!({ data: frame(4, data) });
  bad.raw.onmessage!({
    data: JSON.stringify({ t: "end", id: 4, sha256: "0".repeat(64) }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(bad.sent[1] as string), {
    t: "failed",
    id: 4,
    reason: "incomplete",
  });
  assert.equal(downloads.length, 0);

  deliver(JSON.stringify({ t: "end", id: 2, sha256: good }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(sent[1] as string), { t: "done", id: 2 });
  assert.deepEqual(downloads, ["log.txt"]);
  assert.equal(transfers.at(-1)?.status, "done");
  assert.equal(transfers.at(-1)?.incoming, true);

  // Too large for the browser: declined with a reason, never accepted.
  const huge = fakeChannel();
  const third = new FileSender(
    huge.channel,
    () => undefined,
    () => undefined,
    () => undefined,
  );
  await third.accept({ id: 6, name: "big.iso", size: 600 * 1024 * 1024 });
  assert.deepEqual(JSON.parse(huge.sent[0] as string), {
    t: "reject",
    id: 6,
    reason: "too-large",
  });
});

test("a file over the memory limit streams to the file the person chose, and only becomes a file if it is intact", async () => {
  const { FileSender } = await import("../src/file-transfer.js");
  const written: Uint8Array[] = [];
  let closed = 0;
  let aborted = 0;
  const host = globalThis as unknown as { showSaveFilePicker?: unknown };
  host.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      write: async (data: Uint8Array) => {
        written.push(new Uint8Array(data));
      },
      close: async () => {
        closed += 1;
      },
      abort: async () => {
        aborted += 1;
      },
    }),
  });
  try {
    const big = 600 * 1024 * 1024;
    const run = async (sha256: (bytes: Uint8Array) => string) => {
      const { channel, raw, sent } = fakeChannel();
      const transfers: { status: string }[] = [];
      const sender = new FileSender(
        channel,
        (t) => t && transfers.push(t),
        () => undefined,
      );
      await sender.accept({ id: 2, name: "big.iso", size: big });
      assert.deepEqual(JSON.parse(sent[0] as string), { t: "accept", id: 2 });
      return { raw, sent, transfers, sha256 };
    };

    // The size announced is large, but only the bytes that arrive are written, in order, never held for later.
    const ok = await run(() => "");
    const first = new Uint8Array(1000).fill(7);
    const hashMatch = new Sha256().update(first).hex();
    // The announced size is not reached, so even a matching checksum is refused: it is not intact.
    ok.raw.onmessage!({ data: frame(2, first) });
    ok.raw.onmessage!({
      data: JSON.stringify({ t: "end", id: 2, sha256: hashMatch }),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(written.length, 1);
    assert.equal(written[0]!.length, 1000);
    assert.equal(aborted, 1, "a short file leaves nothing behind");
    assert.equal(closed, 0);
    assert.equal(JSON.parse(ok.sent[1] as string).reason, "incomplete");

    // No streaming support: declined, the offer is never accepted.
    delete host.showSaveFilePicker;
    const none = fakeChannel();
    const refused = new FileSender(
      none.channel,
      () => undefined,
      () => undefined,
    );
    await refused.accept({ id: 4, name: "big.iso", size: big });
    assert.equal(JSON.parse(none.sent[0] as string).reason, "too-large");
  } finally {
    delete host.showSaveFilePicker;
  }
});

test("an upload carries on from the part the computer kept only if that part is exactly this file's start", async () => {
  const { FileSender } = await import("../src/file-transfer.js");
  const bytes = randomBytes(50_000);
  const file = new File([bytes], "tool.bin");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const start = () => {
    const { channel, raw, sent } = fakeChannel();
    const sender = new FileSender(
      channel,
      () => undefined,
      () => undefined,
    );
    sender.ready = true;
    return { sender, raw, sent };
  };
  const frames = (sent: (string | Uint8Array)[]) =>
    sent.filter((item): item is Uint8Array => typeof item !== "string");

  // The computer kept the first 20,000 bytes and proves it with their hash: only the rest is sent.
  const good = start();
  const done = good.sender.send(file);
  await settle();
  assert.equal(JSON.parse(good.sent[0] as string).fresh, undefined);
  good.raw.onmessage!({
    data: JSON.stringify({
      t: "accept",
      id: 1,
      resume: {
        offset: 20_000,
        sha256: createHash("sha256")
          .update(bytes.subarray(0, 20_000))
          .digest("hex"),
      },
    }),
  });
  await settle();
  const payload = Buffer.concat(frames(good.sent).map((f) => f.subarray(4)));
  assert.deepEqual(payload, bytes.subarray(20_000));
  const end = JSON.parse(good.sent.at(-1) as string);
  assert.equal(end.t, "end");
  assert.equal(end.sha256, createHash("sha256").update(bytes).digest("hex"));
  good.raw.onmessage!({
    data: JSON.stringify({ t: "done", id: 1, name: "tool.bin" }),
  });
  assert.equal(await done, "done");

  // A kept part that is not this file's start is thrown away and the file starts again from nothing.
  const bad = start();
  void bad.sender.send(file);
  await settle();
  bad.raw.onmessage!({
    data: JSON.stringify({
      t: "accept",
      id: 1,
      resume: { offset: 20_000, sha256: "0".repeat(64) },
    }),
  });
  await settle();
  const messages = bad.sent
    .filter((item) => typeof item === "string")
    .map((item) => JSON.parse(item as string));
  assert.equal(messages[1].t, "cancel");
  assert.equal(messages[2].t, "offer");
  assert.equal(messages[2].fresh, true);
});
