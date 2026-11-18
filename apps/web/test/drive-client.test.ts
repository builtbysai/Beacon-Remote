import assert from "node:assert/strict";
import { test } from "node:test";
import { DriveClient, DriveRefused } from "../src/drive-client.js";

function fakeTransport() {
  const sent: string[] = [];
  return {
    sent,
    transport: {
      open: true,
      send(text: string) {
        sent.push(text);
      },
    },
  };
}

test("replies answer commands in order and refusals reject with the reason", async () => {
  const { sent, transport } = fakeTransport();
  const client = new DriveClient(transport);
  const listing = client.list(["docs"]);
  const denied = client.run({ op: "delete", path: ["docs"] });
  assert.deepEqual(JSON.parse(sent[0]!), { op: "list", path: ["docs"] });
  client.receive(
    JSON.stringify({
      type: "entries",
      entries: [{ name: "a.txt", isDir: false, size: 3 }],
    }),
  );
  client.receive(JSON.stringify({ type: "refused", reason: "read-only" }));
  assert.deepEqual(await listing, [{ name: "a.txt", isDir: false, size: 3 }]);
  await assert.rejects(
    denied,
    (error: unknown) =>
      error instanceof DriveRefused && error.reason === "read-only",
  );
});

test("a closed or unopened channel refuses without sending anything", async () => {
  const { sent, transport } = fakeTransport();
  const closed = new DriveClient({ ...transport, open: false });
  await assert.rejects(closed.list([]), /not connected/);
  const client = new DriveClient(transport);
  const waiting = client.list([]);
  client.close();
  await assert.rejects(waiting, /connection ended/);
  await assert.rejects(client.list([]), /not connected/);
  assert.equal(sent.length, 1);
});

test("an unreadable or unknown reply rejects instead of answering the wrong command", async () => {
  const { transport } = fakeTransport();
  const client = new DriveClient(transport);
  const first = client.list([]);
  client.receive("not json");
  await assert.rejects(first, /unreadable/);
  const second = client.list([]);
  client.receive(JSON.stringify({ type: "surprise" }));
  await assert.rejects(second, /unknown reply/);
});

import { readFile, writeFile, DRIVE_CHUNK } from "../src/drive-client.js";

// A stand-in computer: answers reads and writes from one in-memory file, the way the host does.
function fakeComputer(initial: Uint8Array) {
  let content = initial;
  const transport = {
    open: true,
    send(text: string) {
      const command = JSON.parse(text);
      queueMicrotask(() => {
        if (command.op === "read") {
          const slice = content.subarray(
            command.offset,
            command.offset + command.length,
          );
          client.receive(
            JSON.stringify({
              type: "data",
              data: Buffer.from(slice).toString("base64"),
            }),
          );
        } else if (command.op === "write") {
          const data = Buffer.from(command.data, "base64");
          const next = new Uint8Array(
            Math.max(content.length, command.offset + data.length),
          );
          next.set(content);
          next.set(data, command.offset);
          content = next;
          client.receive(JSON.stringify({ type: "done" }));
        } else {
          client.receive(JSON.stringify({ type: "done" }));
        }
      });
    },
  };
  const client = new DriveClient(transport);
  return {
    client,
    get content() {
      return content;
    },
  };
}

test("files move in bounded steps and arrive byte for byte", async () => {
  const original = new Uint8Array(DRIVE_CHUNK * 2 + 17).map(
    (_, i) => (i * 31) & 255,
  );
  const computer = fakeComputer(original);
  const read = await readFile(computer.client, ["a.bin"], original.length);
  assert.deepEqual(read, original);
  const upload = new Uint8Array(DRIVE_CHUNK + 5).map((_, i) => (i * 7) & 255);
  const sink = fakeComputer(new Uint8Array(0));
  await writeFile(sink.client, ["b.bin"], upload);
  assert.deepEqual(sink.content, upload);
});

test("a file that shrinks while it is read is reported, not padded with zeros", async () => {
  const computer = fakeComputer(new Uint8Array(10));
  await assert.rejects(
    readFile(computer.client, ["x"], 20),
    /changed while it was read/,
  );
});
