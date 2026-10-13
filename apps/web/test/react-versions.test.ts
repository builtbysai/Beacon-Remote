import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// React refuses to start when react and react-dom differ, and nothing else in the suite mounts the app, so a
// dependency bump that moves only one of them would ship a blank page.
test("react and react-dom are the same version", () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../node_modules/${name}/package.json`, import.meta.url),
        "utf8",
      ),
    ).version as string;
  assert.equal(read("react-dom"), read("react"));
});
