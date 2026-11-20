import assert from "node:assert/strict";
import test from "node:test";
import { relayCredentials } from "../src/relay.js";

const config = {
  TURN_URLS: ["turn:relay.example.test:3478"],
  TURN_SECRET: "test-secret",
} as unknown as Parameters<typeof relayCredentials>[0];
const expires = new Date(Date.now() + 600_000);

test("a reconnect gets its own relay user so the dropped allocation does not block it", () => {
  const first = relayCredentials(config, "session-1", expires);
  const again = relayCredentials(config, "session-1", expires, "ab12cd34");
  assert.notEqual(first.username, again.username);
  assert.notEqual(first.credential, again.credential);
  assert.ok(again.username.endsWith(":session-1:ab12cd34"));
});

test("without a variant the credential is unchanged", () => {
  const a = relayCredentials(config, "session-1", expires);
  const b = relayCredentials(config, "session-1", expires);
  assert.equal(a.username, b.username);
  assert.equal(a.credential, b.credential);
});
