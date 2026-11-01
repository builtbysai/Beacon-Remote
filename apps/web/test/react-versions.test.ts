import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

// React refuses to start when react and react-dom differ, and nothing else in the suite mounts the app, so a
// dependency bump that moves only one of them would ship a blank page.
test("react and react-dom are the same version", () => {
  const require = createRequire(import.meta.url);
  const read = (name: string) =>
    JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8"))
      .version as string;
  assert.equal(read("react-dom"), read("react"));
});
