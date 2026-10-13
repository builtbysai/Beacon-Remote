// Writes the downloads manifest for a built development package, and signs it for host updates
// (ADR 0028) when a private key is given. Usage:
//   node scripts/publish-download.mjs dist/BeaconRemoteDevelopment-<commit>.zip <out-dir> [key.pem]
// Copy the zip, then manifest.json and manifest.sig, to the server's /opt/beacon-remote/downloads
// (manifest.json and manifest.sig last, in that order, so a signature never refers to a missing zip).
import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const [zip, out, keyPath] = process.argv.slice(2);
if (!zip || !out)
  throw new Error("usage: publish-download.mjs <zip> <out-dir>");
const file = basename(zip);
const match = /^BeaconRemoteDevelopment-([a-f0-9]{8,40})\.zip$/.exec(file);
if (!match) throw new Error("unexpected package name");
const bytes = readFileSync(zip);
mkdirSync(out, { recursive: true });
copyFileSync(zip, join(out, file));
const manifest =
  JSON.stringify(
    {
      version: `development-${match[1]}`,
      commit: match[1],
      file,
      bytes: statSync(zip).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      // Hosts only accept a feed newer than the last one they installed, so an old signed manifest
      // cannot be replayed to roll them back.
      sequence: Math.floor(Date.now() / 1000),
      publishedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n";
writeFileSync(join(out, "manifest.json"), manifest);
if (keyPath) {
  const key = createPrivateKey(readFileSync(keyPath));
  writeFileSync(
    join(out, "manifest.sig"),
    sign(null, Buffer.from(manifest), key).toString("base64") + "\n",
  );
  console.log(`Signed ${join(out, "manifest.json")}`);
}
console.log(`Wrote ${join(out, "manifest.json")}`);
