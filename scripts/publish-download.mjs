// Writes the downloads manifest for a built development package, and signs it for host updates
// (ADR 0028) when a private key is given. Usage:
//   node scripts/publish-download.mjs dist/BeaconRemoteDevelopment-<commit>.zip <out-dir> [key.pem] [dist/BeaconRemoteSetup-<commit>.exe] [dist/BeaconRemoteDevelopment-<commit>-trust]
// The last argument is the folder `scripts/Beacon-Signing.ps1 -Action Package` wrote (ADR 0035): its public certificate
// and Trust-BeaconRemote.ps1 are published beside the installer and described in the manifest.
// Copy the zip (and the installer), then manifest.json and manifest.sig, to the server's /opt/beacon-remote/downloads
// (manifest.json and manifest.sig last, in that order, so a signature never refers to a missing zip).
import {
  createHash,
  createPrivateKey,
  sign,
  X509Certificate,
} from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const [zip, out, keyPath, installerPath, trustDir] = process.argv.slice(2);
if (!zip || !out)
  throw new Error("usage: publish-download.mjs <zip> <out-dir>");
const file = basename(zip);
const match = /^BeaconRemoteDevelopment-([a-f0-9]{8,40})\.zip$/.exec(file);
if (!match) throw new Error("unexpected package name");
const bytes = readFileSync(zip);
mkdirSync(out, { recursive: true });
copyFileSync(zip, join(out, file));
// The double-click installer (ADR 0030) carries the same programs as the zip, so it must be the same commit.
let installer;
if (installerPath) {
  const name = basename(installerPath);
  if (name !== `BeaconRemoteSetup-${match[1]}.exe`)
    throw new Error("installer must be BeaconRemoteSetup-<same commit>.exe");
  const exe = readFileSync(installerPath);
  copyFileSync(installerPath, join(out, name));
  installer = {
    file: name,
    bytes: exe.length,
    sha256: createHash("sha256").update(exe).digest("hex"),
  };
}
// Beacon Remote's own signing certificate and the one-file script that trusts it on other computers.
let signing;
if (trustDir) {
  const cer = readFileSync(join(trustDir, "beacon-remote-signing.cer"));
  const script = readFileSync(join(trustDir, "Trust-BeaconRemote.ps1"));
  copyFileSync(
    join(trustDir, "beacon-remote-signing.cer"),
    join(out, "beacon-remote-signing.cer"),
  );
  copyFileSync(
    join(trustDir, "Trust-BeaconRemote.ps1"),
    join(out, "Trust-BeaconRemote.ps1"),
  );
  const sha256 = createHash("sha256").update(cer).digest("hex");
  if (!script.toString("utf8").includes(sha256.toUpperCase()))
    throw new Error(
      "Trust-BeaconRemote.ps1 was not built for this certificate",
    );
  signing = {
    certificate: "beacon-remote-signing.cer",
    sha256,
    script: "Trust-BeaconRemote.ps1",
    scriptSha256: createHash("sha256").update(script).digest("hex"),
    notAfter: new Date(new X509Certificate(cer).validTo).toISOString(),
  };
}
const manifest =
  JSON.stringify(
    {
      version: `development-${match[1]}`,
      commit: match[1],
      file,
      bytes: statSync(zip).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(installer ? { installer } : {}),
      ...(signing ? { signing } : {}),
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
