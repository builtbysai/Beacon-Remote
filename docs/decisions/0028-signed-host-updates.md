# 0028 — Signed host updates

Date: 2026-10-13

## Decision

The Windows host can update itself when the person asks. The server publishes `downloads/manifest.json` and
`downloads/manifest.sig`, an Ed25519 signature over the exact manifest bytes. Hosts trust only the update
public key built into them (private key in the owner's secrets folder, never in Git).
Authenticode signing is a separate matter and still waits for a real certificate; this protects the update
channel, not the executables' publisher identity in Windows.

## Flow

1. **Check** (host window button, or `beacon-remote-agent update check`): fetch manifest and signature from the
   paired server only, verify the signature, validate the manifest's shape, and offer the update only if it is a
   different build and its `sequence` is newer than the last one installed (so an old signed manifest cannot be
   replayed to roll a host back).
2. **Install** (only after a confirmation): download the package, check size and SHA-256 against the signed
   manifest, extract only the expected flat files, check each program against the package's own manifest.
3. **Apply**: the staged copy of the new host waits for the running one to exit, keeps the current files in
   `previous\`, copies the new ones, records the feed sequence in `installed.json`, and starts the updated host. A
   failure puts the old files back. `beacon-remote-host.exe --rollback <install dir>` restores `previous\`.

## Rules

- Nothing is downloaded or installed unasked. There is no background updater.
- The update key is not the server's: a compromised web host cannot ship a host update without it. A lost key
  means the next agent is installed by hand with a new key built in.
- Pairing and identity are untouched; an update never re-pairs.

## Known limits

Hosts built before this decision have no updater and need one manual reinstall. The packages are unsigned
development builds; SmartScreen may still warn on first install.
