import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// ADR 0062: a computer's public key is written once, when it is enrolled or paired. Nothing may re-key an existing
// computer, because the viewer treats a changed key for a known computer as a warning sign. The sign-in and boot
// tables have their own keys and are not covered by this rule.
test("no backend code updates the public key of an existing machine", () => {
  const dir = new URL("../src/", import.meta.url);
  const offenders = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) =>
      /UPDATE\s+machines\s+SET[^;`"]*public_key/i.test(
        readFileSync(new URL(name, dir), "utf8"),
      ),
    );
  assert.deepEqual(offenders, []);
});
