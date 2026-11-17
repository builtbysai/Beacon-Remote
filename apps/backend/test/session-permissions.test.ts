import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionPermissionRequests } from "../src/session-permissions.js";

test("permission prompts only accept decisions from the current machine before expiry", () => {
  let now = 1000;
  const events: { role: string; message: Record<string, unknown> }[] = [];
  const requests = new SessionPermissionRequests(
    (role, message) => events.push({ role, message }),
    () => now,
  );
  const offer = {
    type: "permission-options",
    generation: 0,
    scopes: ["control", "files", "audio", "recording"],
  } as const;
  const ask = {
    type: "permission-request",
    generation: 0,
    attempt: "a2312159-e5e9-47ae-bce9-e3ba5657f4db",
    scope: "files",
  } as const;
  requests.receive("viewer", { ...offer, scopes: [...offer.scopes] }, true);
  assert.equal(events.length, 0);
  requests.receive("machine", { ...offer, scopes: [...offer.scopes] }, false);
  assert.deepEqual(events.pop()?.message.scopes, [
    "files",
    "audio",
    "recording",
  ]);
  requests.receive("viewer", { ...ask, scope: "control" }, false);
  assert.equal(events.pop()?.message.type, "permission-unavailable");
  requests.receive("viewer", ask, false);
  const prompt = events.pop();
  assert.equal(prompt?.role, "machine");
  assert.equal(prompt?.message.type, "permission-prompt");
  const id = prompt?.message.id as string;
  assert.equal(events.pop()?.message.id, id);

  const decision = {
    type: "permission-decision",
    generation: 0,
    id,
    approved: true,
  } as const;
  requests.receive("viewer", decision, false);
  assert.equal(events.length, 0);
  requests.receive("viewer", ask, false);
  assert.equal(events.pop()?.message.type, "permission-unavailable");
  now += 30_000;
  requests.receive("machine", decision, false);
  assert.deepEqual(
    events
      .splice(0)
      .map(({ role, message }) => [role, message.type, message.outcome]),
    [
      ["machine", "permission-dismiss", undefined],
      ["viewer", "permission-result", "expired"],
    ],
  );

  requests.receive("viewer", ask, false);
  const laterId = events.pop()?.message.id as string;
  assert.notEqual(laterId, id);
  events.pop();
  requests.receive("machine", decision, false);
  assert.equal(events.length, 0);
  requests.detach();
  assert.deepEqual(
    events.splice(0).map(({ message }) => [message.type, message.id]),
    [
      ["permission-dismiss", laterId],
      ["permission-result", laterId],
    ],
  );
  requests.resume(1);
  requests.receive("machine", { ...decision, id: laterId }, false);
  requests.receive("viewer", ask, false);
  assert.equal(events.length, 0);
  requests.receive("viewer", { ...ask, generation: 1 }, false);
  assert.equal(events.pop()?.message.type, "permission-unavailable");
  now += 5_000;
  requests.receive(
    "machine",
    { ...offer, generation: 1, scopes: ["control"] },
    true,
  );
  events.pop();
  requests.receive("viewer", { ...ask, generation: 1, scope: "control" }, true);
  const cancelledId = events.pop()?.message.id as string;
  events.pop();
  requests.receive(
    "viewer",
    { type: "permission-cancel", generation: 1, id: cancelledId },
    true,
  );
  assert.equal(events.pop()?.message.outcome, "cancelled");
  assert.equal(events.pop()?.message.type, "permission-dismiss");
  now += 5_000;
  requests.receive("viewer", { ...ask, generation: 1, scope: "control" }, true);
  const revokedId = events.pop()?.message.id as string;
  events.pop();
  requests.receive(
    "machine",
    { ...decision, generation: 1, id: revokedId },
    false,
  );
  assert.equal(events.pop()?.message.outcome, "denied");
});
