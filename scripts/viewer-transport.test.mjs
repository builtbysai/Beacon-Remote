import assert from "node:assert/strict";
import { test } from "node:test";
import { cdpConnection } from "./acceptance/cdp.mjs";
function socket() {
  const sent = [];
  return {
    readyState: 1,
    sent,
    send(value) {
      sent.push(JSON.parse(value));
    },
  };
}
test("browser replies are correlated; malformed/event messages do not consume another request", async () => {
  const ws = socket();
  const send = cdpConnection(ws, 100);
  const first = send("first"),
    second = send("second");
  ws.onmessage({ data: "not json" });
  ws.onmessage({ data: JSON.stringify({ method: "event" }) });
  ws.onmessage({ data: JSON.stringify({ id: 2, result: { ok: 2 } }) });
  ws.onmessage({ data: JSON.stringify({ id: 1, result: { ok: 1 } }) });
  assert.equal((await first).result.ok, 1);
  assert.equal((await second).result.ok, 2);
});
test("browser closure rejects all waiting requests and later calls", async () => {
  const ws = socket();
  const send = cdpConnection(ws);
  const first = assert.rejects(send("first"), /closed/),
    second = assert.rejects(send("second"), /closed/);
  ws.onclose();
  await Promise.all([first, second]);
  await assert.rejects(send("third"), /closed/);
});
test("browser errors and missing replies are bounded failures", async () => {
  const ws = socket();
  const send = cdpConnection(ws, 15);
  const bad = assert.rejects(send("bad"), /failed/);
  ws.onmessage({
    data: JSON.stringify({ id: 1, error: { message: "not supported" } }),
  });
  await bad;
  await assert.rejects(send("no reply"), /timed out/);
});
