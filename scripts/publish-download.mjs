// Writes the downloads manifest for a built development package. Usage:
//   node scripts/publish-download.mjs dist/BeaconRemoteDevelopment-<commit>.zip <out-dir>
// Copy the zip and manifest.json to the server's /opt/beacon-remote/downloads (manifest last).
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const [zip, out] = process.argv.slice(2);
if (!zip || !out)
  throw new Error("usage: publish-download.mjs <zip> <out-dir>");
const file = basename(zip);
const match = /^BeaconRemoteDevelopment-([a-f0-9]{8,40})\.zip$/.exec(file);
if (!match) throw new Error("unexpected package name");
const bytes = readFileSync(zip);
mkdirSync(out, { recursive: true });
copyFileSync(zip, join(out, file));
writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify(
    {
      version: `development-${match[1]}`,
      commit: match[1],
      file,
      bytes: statSync(zip).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      publishedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${join(out, "manifest.json")}`);
