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
