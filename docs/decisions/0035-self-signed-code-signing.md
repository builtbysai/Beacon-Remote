# 0035: Free self-signed code signing, trusted on purpose

Status: accepted, 2026-10-14

## Context

Beacon Remote's programs were unsigned, so Windows shows an "unknown publisher" warning. A public Authenticode
certificate costs money every year, or needs a legal entity or an open-source licence. The owner wants a free
option that works on their own devices now.

## Decision

- **One self-signed certificate**, `CN=Beacon Remote, O=Beacon Remote (self-signed)`: RSA 3072, SHA-256, code signing
  only (so it cannot vouch for a website), valid for three years. It is made by
  `scripts/Beacon-Signing.ps1 -Action New`.
- **The private key never leaves a protected file.** It lives in a password-protected `.pfx` under
  `%USERPROFILE%\.beacon\secrets\remote-codesign`, readable only by the owner's Windows user, and is removed from the
  certificate store right after creation. CI can instead supply `BEACON_SIGNING_PFX` and
  `BEACON_SIGNING_PFX_PASSWORD`. Nothing in the repository holds a key; only the public certificate is published.
- **Signing is part of the existing build.** `scripts/Build-DevelopmentHost.ps1` signs the three programs and the
  two PowerShell scripts before anything is hashed, so the update feed's SHA-256 and the installer carry the signed
  files, then signs `BeaconRemoteSetup-<commit>.exe` last. Every signature is timestamped by a public RFC 3161
  server (free), so files stay valid after the certificate expires. The build fails rather than ship a signature it
  could not timestamp.
- **The installer carries the public certificate and one trust step.** On a computer that does not trust the
  certificate yet it asks once, showing the SHA-256 fingerprint, and on Yes starts itself again through the normal
  Windows administrator prompt (`--trust-certificate`). That worker checks the fingerprint against the one fixed at
  build time, then adds the certificate to Trusted Root Certification Authorities and Trusted Publishers on the
  machine. The install itself stays per-user with no elevation. Computers that already trust it are skipped,
  `--silent` never asks, and declining never blocks the install. Uninstall offers to withdraw the trust.
- **`Trust-BeaconRemote.ps1`** is a generated, standalone, one-file script for the owner's other computers. It embeds
  the certificate, refuses if its fingerprint does not match (or the `-Fingerprint` the person typed), asks for
  administrator approval once, and skips computers already configured. `-Status`, `-Remove` and `-Revoke` are
  supported. `-Quiet` runs it as a Group Policy startup script; the same certificate can be imported natively through
  Group Policy Public Key Policies instead. The Downloads page shows the fingerprint and the steps.
- **Updates need nothing new.** Hosts update from the Ed25519-signed feed exactly as before (ADR 0028); the zip now
  holds signed programs because they were signed before it was made.
- **Lifecycle.** `-Action Renew` (within 90 days of expiry) keeps the old certificate and makes a new one; new
  installs offer to trust the new fingerprint. `-Action Revoke` (key lost or stolen) records the certificate in a
  revoked list that later installers and the trust script apply: removed from both trusted stores and added to
  Disallowed. `-Remove` on the script, or the uninstall question, withdraws trust on one computer.

## What this does and does not do

- It is for devices that opt in. Anyone else downloading the installer still sees "unknown publisher". It does not
  clear Microsoft SmartScreen, which uses its own reputation data: a file downloaded in a browser may still show a
  SmartScreen prompt the first time even where the certificate is trusted.
- Trusting a certificate in Trusted Root means that whoever holds its private key could sign programs that this
  computer then accepts as Beacon Remote's. That is why the key stays in a protected file, why the certificate is
  limited to code signing, and why revocation exists. Trust only computers you own or administer.
- Windows has no revocation list for a self-signed certificate, so revocation reaches a computer only when it runs a
  newer installer or script. Computers that never do keep trusting it until `-Remove` is run on them.
- Tests cover the store logic against in-memory stores and never touch the real machine; the administrator-approved
  import was checked by hand (`docs/acceptance-checklist.md`, section 8).
