import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  permissionRequests,
  type PermissionRequestView,
} from "../src/permission-requests.js";

test("permission requests are correlated to the current viewer and remain cancellable", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: Parameters<Parameters<typeof permissionRequests>[0]>[0][] = [];
  const views: PermissionRequestView[] = [];
  const requests = permissionRequests(
    (command) => sent.push(command),
    (view) => views.push(view),
  );
  assert.equal(sent.length, 0);
  const options = {
    type: "permission-options",
    generation: 0,
    scopes: ["files"],
  };
  requests.receive(options);
  requests.request("control");
  assert.equal(sent.length, 0);
  requests.request("files");
  requests.request("files");
  assert.equal(sent.length, 1);
  const first = sent[0]!;
  assert.equal(first.type, "permission-request");
  t.mock.timers.tick(8000);
  assert.match(views.at(-1)!.status, /did not answer/);
  requests.request("files");
  const second = sent[1]!;
  assert.equal(second.type, "permission-request");
  const id = randomUUID();
  const acknowledgement = {
    type: "permission-pending",
    generation: 0,
    id,
    scope: "files",
    timeoutMs: 30_000,
  };
  requests.receive({ ...acknowledgement, attempt: first.attempt });
  assert.equal(views.at(-1)?.canCancel, false);
  requests.receive({ ...acknowledgement, attempt: second.attempt });
  assert.equal(views.at(-1)?.canCancel, true);
  requests.cancel();
  requests.cancel();
  assert.deepEqual(sent.slice(2), [
    { type: "permission-cancel", id, generation: 0 },
  ]);
  requests.receive({
    type: "permission-result",
    generation: 0,
    id: randomUUID(),
    outcome: "approved",
  });
  assert.equal(views.at(-1)?.busy, true);
  requests.receive({
    type: "permission-result",
    generation: 0,
    id,
    outcome: "cancelled",
  });
  assert.equal(views.at(-1)?.status, "Request cancelled.");
  requests.reset(1);
  requests.receive(options);
  requests.request("files");
  assert.equal(sent.length, 3);
  assert.deepEqual(views.at(-1), {
    options: [],
    status: "",
    busy: false,
    canCancel: false,
  });
});
