import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  signInDisplay,
  signInInput,
  signInAttentionReply,
} from "../src/signin-input.js";
test("sign-in input uses the native namespace and positive sequence without ordinary grants or forbidden capabilities", () => {
  let live = true;
  const scope = {
    leaseId: randomUUID(),
    instanceId: randomUUID(),
    consoleSessionId: 1,
    live: () => live,
  };
  const body = JSON.parse(signInInput(scope, 1, { type: "keep_alive" }));
  assert.equal(body.scope, "windows:sign-in");
  assert.equal(body.leaseId, scope.leaseId);
  assert.equal(body.instanceId, scope.instanceId);
  assert.equal(body.consoleSessionId, 1);
  assert.equal(body.sequence, 1);
  assert.equal("sessionId" in body, false);
  assert.deepEqual(
    JSON.parse(signInInput(scope, 2, { type: "secure_attention" })).input,
    { type: "secure_attention" },
  );
  assert.throws(() =>
    signInInput(scope, 2, { type: "secure_attention", command: "anything" }),
  );
  assert.throws(() =>
    signInInput(scope, Number.MAX_SAFE_INTEGER + 1, {
      type: "secure_attention",
    }),
  );
  assert.throws(() => signInInput(scope, 0, { type: "keep_alive" }));
  assert.throws(() => signInInput(scope, 2, { type: "clipboard_read" }));
  assert.throws(() => signInInput(scope, 2, { type: "nav", action: "home" }));
  assert.throws(() =>
    signInInput({ ...scope, instanceId: "ordinary-grant" }, 2, {
      type: "keep_alive",
    }),
  );
  live = false;
  assert.throws(() =>
    signInInput(scope, 2, {
      type: "key",
      scanCode: 30,
      extended: false,
      down: true,
    }),
  );
});
test("secure attention replies match the exact scope and pending sequence without claiming delivery", () => {
  const scope = {
    leaseId: randomUUID(),
    instanceId: randomUUID(),
    consoleSessionId: 1,
  };
  const reply = {
    ...scope,
    type: "secure-attention",
    version: 1,
    scope: "windows:sign-in",
    sequence: 7,
    status: "requested",
  };
  for (const status of ["requested", "policy-unavailable", "unavailable"])
    assert.equal(
      signInAttentionReply(JSON.stringify({ ...reply, status }), scope, 7)
        ?.status,
      status,
    );
  for (const change of [
    { leaseId: randomUUID() },
    { instanceId: randomUUID() },
    { consoleSessionId: 2 },
    { sequence: 8 },
    { status: "delivered" },
    { command: "anything" },
  ])
    assert.equal(
      signInAttentionReply(JSON.stringify({ ...reply, ...change }), scope, 7),
      null,
    );
});
test("display geometry is bound to the exact worker and preserves encoded letterbox dimensions", () => {
  const scope = {
    leaseId: randomUUID(),
    instanceId: randomUUID(),
    consoleSessionId: 1,
  };
  const display = {
    type: "display",
    version: 1,
    scope: "windows:sign-in",
    ...scope,
    id: "signin-primary",
    width: 1080,
    height: 1920,
    encodedWidth: 1280,
    encodedHeight: 720,
    cursorComposited: true,
  };
  assert.equal(signInDisplay(JSON.stringify(display), scope)?.width, 1080);
  for (const changed of [
    { instanceId: randomUUID() },
    { leaseId: randomUUID() },
    { consoleSessionId: 2 },
    { scope: "desktop:control" },
    { cursorComposited: false },
    { encodedWidth: 1279 },
    { clipboard: true },
  ])
    assert.equal(
      signInDisplay(JSON.stringify({ ...display, ...changed }), scope),
      null,
    );
});
