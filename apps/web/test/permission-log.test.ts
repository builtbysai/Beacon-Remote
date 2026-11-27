import assert from "node:assert/strict";
import test from "node:test";
import { addPermissionLog, permissionLogLine } from "../src/permission-log.js";

test("a permission line says what was asked and what the device did", () => {
  const clock = () => "12:00:00";
  assert.equal(
    permissionLogLine({ at: 0, scope: "control", outcome: "approved" }, clock),
    "12:00:00 Control: allowed on the device",
  );
  assert.equal(
    permissionLogLine({ at: 0, scope: "recording", outcome: "denied" }, clock),
    "12:00:00 Recording: declined on the device",
  );
  assert.equal(
    permissionLogLine({ at: 0, scope: "audio", outcome: "expired" }, clock),
    "12:00:00 Audio: expired",
  );
});

test("the log keeps the newest entries only", () => {
  let log: ReturnType<typeof addPermissionLog> = [];
  for (let i = 0; i < 60; i++)
    log = addPermissionLog(log, { at: i, scope: "files", outcome: "approved" });
  assert.equal(log.length, 50);
  assert.equal(log[0]?.at, 10);
});
