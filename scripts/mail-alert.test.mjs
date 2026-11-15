import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { resolve } from "node:path";

test("health alert renderer preserves all diagnostics and escapes HTML/JSON without sending", () => {
  const text =
    'Disk > 85%\nHost "fixture" <script>invalid</script>\nTab:\there\nRecovery details & quota status.';
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      resolve(import.meta.dirname, "../infrastructure/oracle/render-alert.py"),
      "Beacon Remote <fixture@example.test>",
      "owner@example.test",
      "Beacon Remote: disk needs attention",
    ],
    { input: text, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const mail = JSON.parse(result.stdout);
  assert.equal(mail.text, text);
  assert.equal(mail.subject, "Beacon Remote: disk needs attention");
  assert.match(mail.html, /&lt;script&gt;invalid&lt;\/script&gt;/);
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("Recovery details &amp; quota status."));
  assert.deepEqual(mail.to, ["owner@example.test"]);
});
