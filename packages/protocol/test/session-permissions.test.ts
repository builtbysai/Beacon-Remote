import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sessionPermission,
  sessionPermissionSignal,
} from "../src/session-permissions.js";

test("drive is a session permission the viewer can request and the host can grant", () => {
  assert.equal(sessionPermission.safeParse("drive").success, true);
  assert.equal(sessionPermission.safeParse("admin").success, false);
  const options = sessionPermissionSignal.safeParse({
    type: "permission-options",
    generation: 1,
    scopes: ["control", "files", "audio", "recording", "drive"],
  });
  assert.equal(options.success, true);
});

const SCOPES = sessionPermission.options;
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("the scope list and the options message agree, so a new scope cannot be left out of either", () => {
  assert.deepEqual([...SCOPES].sort(), [
    "audio",
    "clipboard",
    "control",
    "drive",
    "files",
    "print",
    "recording",
    "ui_tree",
  ]);
  // Every scope fits in one options message, and one more than that does not.
  assert.equal(
    sessionPermissionSignal.safeParse({
      type: "permission-options",
      generation: 0,
      scopes: SCOPES,
    }).success,
    true,
  );
  assert.equal(
    sessionPermissionSignal.safeParse({
      type: "permission-options",
      generation: 0,
      scopes: [...SCOPES, "control"],
    }).success,
    false,
  );
});

for (const scope of SCOPES) {
  test(`${scope}: a request, a cancel and a decision are accepted, and nothing extra rides along`, () => {
    const request = {
      type: "permission-request",
      generation: 3,
      attempt: ID,
      scope,
    };
    assert.equal(sessionPermissionSignal.safeParse(request).success, true);
    assert.equal(
      sessionPermissionSignal.safeParse({ ...request, approved: true }).success,
      false,
      "a request cannot carry its own approval",
    );
    assert.equal(
      sessionPermissionSignal.safeParse({
        type: "permission-decision",
        generation: 3,
        id: ID,
        approved: true,
      }).success,
      true,
    );
    assert.equal(
      sessionPermissionSignal.safeParse({
        type: "permission-cancel",
        generation: 3,
        id: ID,
      }).success,
      true,
    );
  });
}

test("malformed permission messages are refused", () => {
  const bad = [
    {
      type: "permission-request",
      generation: 1,
      attempt: "not-a-uuid",
      scope: "control",
    },
    {
      type: "permission-request",
      generation: -1,
      attempt: ID,
      scope: "control",
    },
    {
      type: "permission-request",
      generation: 1025,
      attempt: ID,
      scope: "control",
    },
    {
      type: "permission-request",
      generation: 1.5,
      attempt: ID,
      scope: "control",
    },
    { type: "permission-request", generation: 1, attempt: ID, scope: "admin" },
    { type: "permission-request", generation: 1, attempt: ID },
    { type: "permission-decision", generation: 1, id: ID, approved: "yes" },
    { type: "permission-decision", generation: 1, id: ID },
    { type: "permission-hello", generation: 1, extra: true },
    { type: "permission-grant", generation: 1, scope: "control" },
    {},
    null,
  ];
  for (const message of bad)
    assert.equal(
      sessionPermissionSignal.safeParse(message).success,
      false,
      JSON.stringify(message),
    );
});
