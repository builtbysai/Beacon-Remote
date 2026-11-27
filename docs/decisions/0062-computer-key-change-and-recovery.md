# 0062: A computer's key is its identity; recovery is a new computer

Status: proposed November 27, 2026 (design only; follows [0061](0061-peer-authentication-above-signaling.md)). No code
beyond what 0061 already built.

## What the code does today

A computer's public key is written once, when it is enrolled or paired (`machines.public_key`, set by the insert in the
enrollment and device-pairing routes) and is never updated for that computer. Re-enrolling after a reinstall, a restore
or a replaced device therefore creates a new computer entry with a new id and a new key. The viewer pins keys per
computer id (ADR 0061), so a re-enrolled computer starts a fresh pin; it does not trip a "changed" warning.

## Decision

1. **Identity is the key, and a key never moves between computers.** Keep the rule that a computer id has exactly one
   key for its whole life. Recovery from a lost, reset or replaced computer is a new enrollment, and the old entry is
   revoked rather than re-keyed. Do not add a "replace the key" API.
2. **A changed key for a known id is therefore a warning sign, not a routine event.** It can only mean the server
   returned a different key for an id the browser pinned, which the server's own code never does. The viewer's
   "Trust the new key" button (built) stays, but its words must say this plainly: compare the code with the one in the
   host window, and if you cannot, do not trust it and use a new enrollment instead.
3. **Show the new-enrollment case clearly (to build).** When a person enrolls a computer with the same name as a revoked one, the
   list says the old entry is revoked and the new one has a new key code, so nobody reads the new code as a change.
4. **Backups of the host key are not offered.** The Windows key lives under DPAPI and the Android key under the
   keystore so that copying a profile does not copy an identity. A restored image therefore cannot impersonate the
   computer; it enrolls again. This is a feature; do not add key export.
5. **Account recovery is separate.** Losing a browser pin store (a new browser, cleared storage) only means a new first
   use for that browser, which the key code in the host window and on the More tab lets a person check.

## Not decided here

- Strict mode as the default (waits for every host to sign and for device runs).
- Whether to sign the viewer's side (0061 step 4).

## Checks that would settle it

- A backend test that nothing updates `machines.public_key` after insert (added with this record).
- On devices: reinstall and re-enroll a computer, and confirm the old entry is revoked, the new entry shows a new
  code, and no "changed" warning appears.
