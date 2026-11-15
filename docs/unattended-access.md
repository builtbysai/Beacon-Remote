# Unattended owner access

Development on `codex/unattended-access`, October 29, 2026. Not deployed. Real
Windows service/reboot and physical-phone acceptance are release gates.
Current evidence is in [the October 29 validation record](validation-2026-10-29.md).
Follow-up readiness and re-pairing work is recorded in
[the October 30 validation record](validation-2026-10-30.md).

## Windows setup

Install and pair the host normally, then choose **Set up unattended access** in
the local host window. This enables the host at sign-in and allows the owner's account to view,
control and send files without another Beacon prompt. Sharing stays visible.
The existing separate choices still offer attended access or trusted viewing.
Changing a clearly labeled access choice no longer opens a duplicate Beacon
confirmation dialog. Helper access is independent.

**Start boot status before Windows sign-in** is a separate optional checkbox.
Enabling it asks for Windows administrator setup and installs/binds the existing
presence-only service; disabling it removes that service. The checkbox reads
the service's actual automatic-start configuration. This service reports status
before sign-in; it does not provide sign-in-screen capture or control. Ordinary
trusted owner setup does not install it or ask for administrator approval.

The October 30 requirement now includes initial Windows sign-in-screen control
and full boot startup. That privileged endpoint remains unimplemented and is
required for unattended completion; see [ADR 0048](decisions/0048-boot-login-and-restart.md).

The computer reports boot presence before sign-in. The desktop requires this
Windows user signed in and unlocked. Locked/signed-out computers show why they
cannot be opened. The backend applies the same availability rule to owner,
remembered-helper and one-time support-code session requests. An unavailable
computer does not consume a support code. Boot reports expire independently and
cannot substitute for a fresh interactive host heartbeat.
This does not implement remote Windows login, PIN entry, UAC
control, or capture/input from a service.

The web restart confirmation offers **Reconnect automatically when this computer
returns**. It waits up to ten minutes, detects a new signed host process or an
offline/online transition, then requests a fresh policy-authorized session. It
does not reuse the previous session or escalate a view session to control.
Cancel, navigation, sign-out or lowered/revoked access stop reconnect. Current
hosts still require Windows sign-in/unlock; pre-login reconnection awaits the
new endpoint. The wait is held only in the open browser page.

**Turn off unattended** lowers local permission before contacting the server,
ends helpers using the old local policy, and removes the boot service with
Windows administrator approval. Uninstall removes that service before deleting
the per-user identity. Silent uninstall refuses when privileged service cleanup
is needed, preserving the files so interactive uninstall can finish. A remotely
revoked boot service stops reporting when it receives the signed-identity rejection.

For deliberate re-enrollment, revoke the computer in the workspace and stop its
host before running `forget`. That command first clears all local owner, helper
and file permissions, then removes this pairing's boot service before deleting
the identity. If Windows administrator cleanup is cancelled, the identity stays
available for another cleanup attempt and local permissions stay off. The next
pairing starts attended. Ordinary pairings without a boot service need no
administrator prompt to forget.

The service executable/public binding live beneath Program Files; the separate
DPAPI machine identity is beneath ProgramData with a protected SYSTEM and
Administrators ACL. Existing unexpected ACLs or reparse points are refused.
The service never launches a process or receives desktop tokens/commands.
Repair/update the service through local setup; ordinary host updates cannot
silently replace privileged service code.

## Android setup

Android 11 or later is required for the unattended source. Pair normally, enable
notifications and the Beacon accessibility service in Android Settings, then
choose **Enable unattended access** in Beacon. The setup screen explains that
the owner's account can see/control the unlocked phone and receive files. This
setting is separate from merely enabling accessibility. Guests/support codes
still require attended approval and Android's MediaProjection consent.

Unattended capture uses Android's documented accessibility screenshot API,
limited to approximately two frames per second and 720 pixels on the long edge.
It suits settings and administration, not video playback or audio. Rotation is
handled. Notifications must be enabled; sharing has persistent Pause and Stop.
No raw frames are saved or uploaded outside the authorized WebRTC session.
Secure content is refused, never captured around. Locking, stopping availability,
revoking accessibility/notifications or turning off unattended ends sharing.
After unlocking, a new authorized owner connection can be made without a prompt.
On older Android versions, use the existing attended path.

Both endpoints end unattended sessions after 30 minutes without user input or
file activity. Transport keep-alives do not extend that idle
window. Normal short authorization leases and immediate server revocation still
apply. Android outbound files, sound, full automation/UI-tree tooling and remote
Windows login are not part of this slice.

## Validation and remaining acceptance

Automated route tests exercise real PostgreSQL for boot binding, signatures,
replay, replacement, removal, revocation and isolation from desktop credentials.
Android tests protect the local/policy/owner permission intersection. Run the
normal root `pnpm check`, native checks and Android unit/lint/debug build. Use a
separate `_test` database. The generated Gradle build directories are excluded
from root formatting; source remains checked.

Before release, on a second Windows PC: install/pair, enable once, connect from
another network without an Allow dialog, transfer a file, lower access while
disconnected from the backend, verify Stop and held-input release, lock/unlock,
reboot before and after sign-in, and uninstall. Check service ACLs, key isolation,
tampered installation rejection and removal of service/key. Repeat on a real
Android phone: one-time setup, owner reconnect, guest consent, rotation, Pause,
Stop, permission revocation, protected content, lock/unlock and reboot. Record
network route, device/OS and actual results; do not substitute compilation or
emulator results for those checks.

Apply migrations 023 and 024 before a matching backend/web rollout. They are additive;
rollback may leave the unused table/column in place. Update the backend before
Windows hosts that emit the v2 signed process marker; roll those hosts back
before rolling back to an older backend. Keep the existing production
deployment unchanged until matching artifacts and acceptance are reviewed.
