// Local dummy-token previews only. Does not construct a mailer or open a DB.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { accountMail } from "../src/account-mail.js";

if (!process.env.REMOTE_DEV_STATE_DIR)
  throw new Error("Enter the Remote workspace first");
const output = join(process.env.REMOTE_DEV_STATE_DIR, "mail-previews");
await mkdir(output, { recursive: true });
for (const kind of ["verify", "recover", "existing"] as const) {
  const mail = accountMail(
    kind,
    `https://remote.example.test/#${kind}=preview-only-not-a-valid-token`,
    kind === "verify" ? "24 hours" : "30 minutes",
  );
  await writeFile(join(output, `${kind}.html`), mail.html);
  await writeFile(join(output, `${kind}.txt`), mail.text);
}
const alert = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  [
    fileURLToPath(
      new URL(
        "../../../infrastructure/oracle/render-alert.py",
        import.meta.url,
      ),
    ),
    "Beacon Remote <fixture@example.test>",
    "owner@example.test",
    "Beacon Remote: disk needs attention",
  ],
  {
    input:
      "Disk use 86% exceeds the configured 85% limit.\n\nChecked 2026-11-11 12:00 UTC on fixture-server.\nThis repeats every 6 hours until it clears.",
    encoding: "utf8",
  },
);
if (alert.status !== 0) throw new Error("Operational preview renderer failed");
const mail = JSON.parse(alert.stdout) as { html: string; text: string };
await writeFile(join(output, "operations.html"), mail.html);
await writeFile(join(output, "operations.txt"), mail.text);
console.log(`Dummy-only email previews written to ${output}`);
