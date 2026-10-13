// One-time: create the Ed25519 key that signs the Windows host update feed (ADR 0028).
//   node scripts/make-update-key.mjs <private-key.pem>
// The private key stays outside Git (owner secrets folder). The printed public key is embedded in
// apps/windows-agent/src/update.rs. Refuses to overwrite an existing key.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("usage: make-update-key.mjs <private-key.pem>");
if (existsSync(path))
  throw new Error("Key already exists; refusing to overwrite");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), {
  mode: 0o600,
});
const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
console.log(`Public key (base64): ${raw.toString("base64")}`);
