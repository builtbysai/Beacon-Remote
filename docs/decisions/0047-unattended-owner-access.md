# 0047 — Unattended owner access, with one setup decision

Date: 2026-10-29. Status: implementation; not released or accepted on hardware.

The October 30 requirement in [ADR 0048](0048-boot-login-and-restart.md) expands
the target to Windows sign-in-screen control. This decision records the current
signed-in implementation; its presence-only service is insufficient for that
expanded target. Boot presence is now an independent optional setup choice.

The owner authorized full unattended access and removal of redundant consent on
October 29. A locally enabled standing permission replaces repeated Beacon
prompts for the owner's account. Attended support still asks, and a browser login
alone cannot enable standing permission. Visible sharing, Pause, Stop, immediate
revocation and the single-controller lease remain mandatory.

## Windows

The existing trusted view/control policy supplies session authority. A separate
optional boot-availability service reports presence before sign-in. Its distinct
Ed25519 key can only report availability: it cannot enroll machines, change
access, receive session tokens, fetch files or inject input. The enrolled user
signs the binding of that public key to their machine. Revocation and replacement
invalidate the old binding. The service never refreshes interactive presence.

The service executable is installed in an administrator-controlled directory;
its machine-scoped DPAPI identity is in a SYSTEM/Administrators-only directory.
It has no inbound IPC, process-launch or remote-command interface. Interactive
capture/input remain in the ordinary per-user host, started at sign-in. There is
no privileged capture broker to expose to a user process. Locked and signed-out
states are reported as unavailable for control. This deliberately does not add
remote Windows login or elevated UAC control.

One explicit setup action enables trusted control, file reception and sign-in
startup. Installing boot availability needs Windows administrator approval once;
ordinary sessions need no further Beacon approval. Guest support and remembered
helper permissions are independent and are not expanded by owner setup.

October 30 follow-up: inventory and owner/helper/support session admission use
the same boot-aware interactive readiness rule. A fresh locked/signed-out report
can deny entry, but boot presence cannot confer desktop authority. Local
`forget` clears all standing permission before service and identity removal;
cancelled administrator cleanup keeps the identity for retry with access off.
Re-enrollment must not inherit the previous pairing's unattended permissions.

## Android

Keep the existing attended MediaProjection path. For Android 11+, investigate the
documented AccessibilityService screenshot API as a separate, explicitly enabled
unattended source. It requires the owner to enable the accessibility service
locally, including screen access, and to enable unattended owner access in Beacon.
It is suitable for low-frame-rate administration, not smooth video or audio.
MediaProjection tokens must never be reused to evade per-session platform consent.
Secure content, lock screens and PINs remain boundaries. Missing/revoked local
permission must fail closed, even when the server still allows trusted access.

## Acceptance and release

Exercise real database boundaries for key binding, signatures, replay, replacement,
revocation and isolation from session authority. Exercise service install/start/
stop/uninstall and reboot on Windows, and accessibility capture/revoke/lock on a
real Android phone. Synthetic or emulator evidence is labeled as such. Release
only matching artifacts with migration, rollback and public health checks. The
existing view-only MCP branch is independent; full automation follows separately.
