import assert from "node:assert/strict";
import { test } from "node:test";
import { UiTreeClient } from "../src/ui-tree-client.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "1a8fad5b-d9cb-469f-a165-70867728950e";
const bounds = { x: 0, y: 0, width: 10, height: 10 };
const tree = { role: "window", states: ["enabled"], bounds, children: [] };

function rig(open = true, timeoutMs = 5_000) {
  const sent: string[] = [];
  const state = { open };
  const client = new UiTreeClient(
    {
      get open() {
        return state.open;
      },
      send: (text) => sent.push(text),
    },
    () => ID,
    timeoutMs,
  );
  return { client, sent, state };
}

test("a request carries only its id and a valid answer resolves it", async () => {
  const { client, sent } = rig();
  const pending = client.request();
  assert.deepEqual(JSON.parse(sent[0]!), { type: "ui-tree-request", id: ID });
  client.receive(
    JSON.stringify({
      type: "ui-tree",
      id: ID,
      ok: true,
      truncated: false,
      tree,
    }),
  );
  assert.deepEqual(await pending, { ok: true, truncated: false, tree });
});

test("a refusal says why", async () => {
  for (const reason of ["denied", "busy", "unavailable"] as const) {
    const { client } = rig();
    const pending = client.request();
    client.receive(
      JSON.stringify({ type: "ui-tree", id: ID, ok: false, reason }),
    );
    assert.deepEqual(await pending, { ok: false, reason });
  }
});

test("an answer to another request, or that is not JSON, changes nothing", async () => {
  const { client } = rig(true, 30);
  const pending = client.request();
  client.receive("not json");
  client.receive(
    JSON.stringify({
      type: "ui-tree",
      id: OTHER,
      ok: true,
      truncated: false,
      tree,
    }),
  );
  assert.deepEqual(await pending, { ok: false, reason: "timeout" });
});

test("an answer that breaks the schema ends the request as invalid, and never reaches the caller", async () => {
  const leaky = {
    ...tree,
    children: [
      { ...tree, role: "password", protected: true, name: "Password" },
    ],
  };
  const { client } = rig();
  const pending = client.request();
  client.receive(
    JSON.stringify({
      type: "ui-tree",
      id: ID,
      ok: true,
      truncated: false,
      tree: leaky,
    }),
  );
  assert.deepEqual(await pending, { ok: false, reason: "invalid" });
});

test("a closed channel and a channel that closes mid-request are reported", async () => {
  const closed = rig(false);
  assert.deepEqual(await closed.client.request(), {
    ok: false,
    reason: "closed",
  });
  const { client } = rig();
  const pending = client.request();
  client.close();
  assert.deepEqual(await pending, { ok: false, reason: "closed" });
});

test("the display the boxes are on is passed through when the computer says it", async () => {
  const { client } = rig();
  const pending = client.request();
  const display = { x: -1920, y: 0, width: 1920, height: 1080 };
  client.receive(
    JSON.stringify({
      type: "ui-tree",
      id: ID,
      ok: true,
      truncated: false,
      display,
      tree,
    }),
  );
  assert.deepEqual(await pending, {
    ok: true,
    truncated: false,
    tree,
    display,
  });
});
