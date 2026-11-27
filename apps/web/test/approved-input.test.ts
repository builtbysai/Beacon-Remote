import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedInput, approvedInputPrefix } from "../src/approved-input.js";

test("an upgraded input lane waits for its own approval regardless of arrival order", () => {
  const attached: { channel: RTCDataChannel; geometry?: string }[] = [];
  let pending = "requested";
  const gate = approvedInput(
    (id) => id === pending,
    (channel, geometry) => attached.push({ channel, geometry }),
  );
  function channel(id: string) {
    const raw = {
      label: approvedInputPrefix + id,
      closed: false,
      onmessage: null as ((event: { data: unknown }) => void) | null,
      close() {
        this.closed = true;
      },
    };
    return { raw, rtc: raw as unknown as RTCDataChannel };
  }
  const unsolicited = channel("other");
  gate.offer(unsolicited.rtc);
  assert.equal(unsolicited.raw.closed, true);
  const first = channel(pending);
  gate.offer(first.rtc);
  const geometry = JSON.stringify({
    type: "display",
    id: "0",
    width: 320,
    height: 720,
  });
  first.raw.onmessage?.({ data: geometry });
  assert.equal(attached.length, 0);
  gate.result(pending, true);
  assert.deepEqual(attached.pop(), { channel: first.rtc, geometry });

  pending = "next";
  gate.result(pending, true);
  const next = channel(pending);
  gate.offer(next.rtc);
  assert.deepEqual(attached.pop(), { channel: next.rtc, geometry: undefined });
  const duplicate = channel(pending);
  // The matching result is consumed when the first channel is attached.
  pending = "";
  gate.offer(duplicate.rtc);
  assert.equal(duplicate.raw.closed, true);

  pending = "denied";
  const denied = channel(pending);
  gate.offer(denied.rtc);
  gate.result(pending, false);
  assert.equal(denied.raw.closed, true);
  assert.equal(attached.length, 0);
  gate.dispose();
});
