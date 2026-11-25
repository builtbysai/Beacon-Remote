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
