import assert from "node:assert/strict";
import { test } from "node:test";
import { PRINT_CHUNK, PrintClient, PrintRefused } from "../src/print-client.js";

function computer(options: { permitted?: boolean; refuseBegin?: string } = {}) {
  const received: { op: string; size?: number; bytes?: number }[] = [];
  const transport = {
    open: true,
    send(text: string) {
      const message = JSON.parse(text);
      queueMicrotask(() => {
        if (options.permitted === false)
          return client.receive(
            JSON.stringify({ type: "refused", reason: "not-permitted" }),
          );
        if (message.op === "printers")
          return client.receive(
            JSON.stringify({ type: "printers", names: ["Office Laser"] }),
          );
        if (message.op === "begin") {
          received.push({ op: "begin", size: message.size });
          if (options.refuseBegin)
            return client.receive(
              JSON.stringify({ type: "refused", reason: options.refuseBegin }),
            );
          return client.receive(JSON.stringify({ type: "accepted" }));
        }
        if (message.op === "chunk") {
          const bytes = Buffer.from(message.data, "base64").length;
          received.push({ op: "chunk", bytes });
          return client.receive(
            JSON.stringify({ type: "received", total: bytes }),
          );
        }
        received.push({ op: "print" });
        return client.receive(JSON.stringify({ type: "printed" }));
      });
    },
  };
  const client = new PrintClient(transport);
  return { client, received };
}

test("a file is sent in bounded chunks and printed only after the computer confirms", async () => {
  const { client, received } = computer();
  const file = new Uint8Array(PRINT_CHUNK + 9).map((_, i) => i & 255);
  await client.printFile(1, "Office Laser", file);
  assert.equal(received[0]?.op, "begin");
  assert.equal(received[0]?.size, file.length);
  assert.deepEqual(
    received.filter((r) => r.op === "chunk").map((r) => r.bytes),
    [PRINT_CHUNK, 9],
  );
  assert.deepEqual(received.at(-1), { op: "print" });
});

test("a refused job explains why and nothing is printed", async () => {
  const { client, received } = computer({
    refuseBegin: "printer-not-selected",
  });
  await assert.rejects(
    client.printFile(2, "Other", new Uint8Array(4)),
    (error: unknown) =>
      error instanceof PrintRefused && error.reason === "printer-not-selected",
  );
  assert.equal(
    received.some((r) => r.op === "print"),
    false,
  );
});

test("without printing access the viewer says what to do", async () => {
  const { client } = computer({ permitted: false });
  await assert.rejects(
    client.printFile(3, "Office Laser", new Uint8Array(4)),
    /Ask for Printing access/,
  );
});

test("empty files and a closed channel are refused before anything is sent", async () => {
  const { client } = computer();
  await assert.rejects(
    client.printFile(4, "Office Laser", new Uint8Array(0)),
    /Empty files/,
  );
  const closed = new PrintClient({ open: false, send() {} });
  await assert.rejects(
    closed.printFile(5, "Office Laser", new Uint8Array(1)),
    /not connected/,
  );
});

test("the allowed printers are asked for, not guessed", async () => {
  const { client } = computer();
  assert.deepEqual(await client.printers(), ["Office Laser"]);
  const { client: refused } = computer({ permitted: false });
  await assert.rejects(
    refused.printers(),
    (error) => error instanceof PrintRefused,
  );
});
