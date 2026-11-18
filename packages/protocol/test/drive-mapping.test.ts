import assert from "node:assert/strict";
import { test } from "node:test";
import { driveCommand, driveMappingRequest } from "../src/drive-mapping.js";

const grant = "2d6f4a3e-7c1b-4f0a-9e8d-1a2b3c4d5e6f";

test("drive paths stay inside the mapped folder", () => {
  const read = (path: string[]) =>
    driveCommand.safeParse({
      op: "read",
      grant,
      path,
      offset: 0,
      length: 4096,
    });
  assert.equal(read(["reports", "q3.xlsx"]).success, true);
  assert.equal(read(["..", "secret.txt"]).success, false);
  assert.equal(read(["a\b"]).success, false);
  assert.equal(read(["C:"]).success, false);
  assert.equal(read(["CON"]).success, false);
  assert.equal(read(["name."]).success, false);
  assert.equal(read(["bad\u0000name"]).success, false);
  assert.equal(read(Array.from({ length: 33 }, () => "d")).success, false);
});

test("transfers and commands are bounded and tied to one grant", () => {
  assert.equal(
    driveCommand.safeParse({
      op: "read",
      grant,
      path: ["f"],
      offset: 0,
      length: 2 * 1024 * 1024,
    }).success,
    false,
  );
  assert.equal(
    driveCommand.safeParse({ op: "list", grant: "not-a-uuid", path: [] })
      .success,
    false,
  );
  assert.equal(
    driveCommand.safeParse({ op: "rename", grant, from: [], to: ["x"] })
      .success,
    false,
  );
  assert.equal(
    driveCommand.safeParse({ op: "delete", grant, path: [], extra: 1 }).success,
    false,
  );
});

test("a mapping request never grants more than one bounded window of time", () => {
  const base = {
    type: "drive-map-request",
    generation: 1,
    id: grant,
    label: "Reports",
    rights: "read",
  };
  assert.equal(
    driveMappingRequest.safeParse({ ...base, expiresInSeconds: 3600 }).success,
    true,
  );
  assert.equal(
    driveMappingRequest.safeParse({ ...base, expiresInSeconds: 9 * 3600 })
      .success,
    false,
  );
  assert.equal(
    driveMappingRequest.safeParse({
      ...base,
      expiresInSeconds: 60,
      rights: "admin",
    }).success,
    false,
  );
});
