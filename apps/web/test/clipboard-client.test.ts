import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ClipboardClient,
  ClipboardRefused,
  MAX_WRITE_CHARS,
  type ClipboardMode,
} from "../src/clipboard-client.js";

function computer(
  reply: (message: Record<string, unknown>) => Record<string, unknown>,
) {
  const modes: [ClipboardMode, boolean][] = [];
  const pushed: string[] = [];
  const sent: Record<string, unknown>[] = [];
  const client: ClipboardClient = new ClipboardClient(
    {
      open: true,
      send(text) {
        const message = JSON.parse(text);
        sent.push(message);
        if (message.op === "hello") return;
        queueMicrotask(() => client.receive(JSON.stringify(reply(message))));
      },
    },
    {
      mode: (mode, approved) => modes.push([mode, approved]),
      pushed: (text) => pushed.push(text),
    },
  );
  return { client, modes, pushed, sent };
}

test("a write resolves only when the computer confirms it", async () => {
  const { client, sent } = computer(() => ({ type: "written", chars: 5 }));
  await client.write("hello");
  assert.deepEqual(sent, [{ op: "write", text: "hello" }]);
});

test("a refusal rejects with the computer's reason in plain words", async () => {
  for (const [reason, words] of [
    ["off", /off on this computer/],
    ["needs-approval", /not allowed this yet/],
    ["needs-control", /needs control/],
    ["paused", /paused/],
  ] as const) {
    const { client } = computer(() => ({ type: "refused", reason }));
    await assert.rejects(client.write("x"), (error: unknown) => {
      assert.ok(error instanceof ClipboardRefused);
      assert.equal(error.reason, reason);
      assert.match(error.message, words);
      return true;
    });
  }
});

test("too much text never leaves the viewer", async () => {
  const { client, sent } = computer(() => ({ type: "written", chars: 0 }));
  await assert.rejects(
    client.write("a".repeat(MAX_WRITE_CHARS + 1)),
    (error: unknown) =>
      error instanceof ClipboardRefused && error.reason === "too-long",
  );
  await client.write("a".repeat(MAX_WRITE_CHARS));
  assert.equal(sent.length, 1);
  await assert.rejects(client.write(""));
});

test("the setting arrives on its own and a change follows the person at the computer", () => {
  const { client, modes } = computer(() => ({}));
  client.receive(
    JSON.stringify({ type: "mode", mode: "button", approved: false }),
  );
  client.receive(
    JSON.stringify({ type: "mode", mode: "auto", approved: true }),
  );
  client.receive(
    JSON.stringify({ type: "mode", mode: "nonsense", approved: true }),
  );
  assert.deepEqual(modes, [
    ["button", false],
    ["auto", true],
  ]);
});

test("text pushed by Automatic is not mistaken for the answer to a request", async () => {
  const { client, pushed } = computer((message) =>
    message.op === "read"
      ? { type: "clipboard", text: "asked for", truncated: false }
      : {},
  );
  const read = client.read();
  // The computer pushes something at the same moment; the pending read must still get its own answer.
  client.receive(
    JSON.stringify({
      type: "clipboard",
      text: "copied there",
      truncated: false,
      auto: true,
    }),
  );
  assert.deepEqual(await read, { text: "asked for", truncated: false });
  assert.deepEqual(pushed, ["copied there"]);
});

test("an empty computer clipboard and a closed channel are reported, not swallowed", async () => {
  const empty = computer(() => ({
    type: "clipboard",
    text: "",
    truncated: false,
    unavailable: true,
  }));
  await assert.rejects(empty.client.read(), /no text/);
  const closed = computer(() => ({}));
  const pending = closed.client.write("a");
  closed.client.close();
  await assert.rejects(pending, /ended/);
});
