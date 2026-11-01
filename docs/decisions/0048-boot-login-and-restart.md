# 0048 — Boot startup, Windows sign-in and restart recovery

Date: 2026-10-30. Scope authorized by the owner; sign-in endpoint not implemented.

The owner explicitly requires optional startup at Windows boot, remote control
at the initial Windows sign-in screen and reconnection after restart. The
signed-in-only target in ADR 0047 is therefore insufficient for completion of
the unattended milestone. Its current presence-only service is not a sign-in
endpoint and must never be represented as one.

## Implemented foundation

Boot presence is now an independent optional local setting. Ordinary trusted
owner setup enables the per-user host at sign-in and owner control/files without
installing a privileged service. The boot-status option installs/removes the
existing presence-only service with Windows administrator approval and reads its
actual SCM startup configuration. It does not raise owner/helper desktop policy.
Changing boot startup does not start a deliberately stopped interactive host.

The restart confirmation offers automatic reconnect. The browser waits up to
ten minutes for a new signed host process identity, or an offline/online
transition for older endpoints. It then requests a new session under the
current owner policy. It never revives an old token or silently broadens view
to control. Cancel, navigation, sign-out, revocation and lowered permissions
invalidate pending reconnect; late grants are stopped. Current capture still
requires Windows sign-in/unlock. The process marker proves a host process
changed, not that Windows rebooted; restarting the host also qualifies.

Heartbeat canonical domain v2 signs the optional host process UUID. Requests
without that field retain domain v1 and remain supported. Removing/substituting
the UUID invalidates the signature. Migration 024 adds the nullable marker;
legacy heartbeats clear it rather than preserving stale process metadata.
Deploy migrations and the compatible backend before updating Windows clients.
For rollback, replace v2-emitting hosts before rolling back the backend.

## Required sign-in endpoint

Implement a separate administrator-installed machine endpoint, default off,
with an explicit standing owner permission for Windows sign-in. Use a separate
restricted machine credential and a distinct sign-in session scope. Do not
upgrade the boot-presence key to desktop authority or copy the ordinary user's
DPAPI private key into a service. Existing helpers, guest support, ordinary
desktop grants and browser login alone cannot enable this permission.

The SCM service supervises a narrowly scoped worker in the active console's
interactive session and correct desktop. No media/input runs in Session 0.
The worker must use Windows-granted rights and supported capture/input APIs;
never disable UAC, weaken desktop ACLs, steal another process's token, spoof
Windows authentication or enable automatic Windows login. Windows still checks
the credentials the owner enters. BitLocker/firmware prompts before Windows
starts remain outside a Windows service's reach.

Use a separate DXGI capture adapter for the sign-in desktop; the existing WGC
capture adapter and its secure-desktop rejection remain unchanged for ordinary
sessions. Microsoft documents that secure-desktop duplication requires
LOCAL_SYSTEM rights. Supported interactive service workers need explicit
session/window-station/desktop placement. Handle desktop switches and device
loss as authorization boundaries, releasing input and discarding cached frames.

Service/worker communication must use administrator-controlled executables and
a private inherited channel with an explicit handle list, peer/lifetime binding,
bounded messages and no arbitrary command/path/desktop selection. There is no
general privileged process launcher. Owner-only short leases and a single
controller apply before capture/input starts. Service shutdown, local disable,
revocation, expired lease, browser loss and worker crash release input and
terminate the worker. Expose visible connection identity and Stop on the active
desktop, including sign-in. Files, clipboard, recording, audio and automation
stay off in the sign-in scope. Never log/store typed Windows credentials or
screen pixels. Secure attention must use an explicitly supported Windows path,
not synthetic Ctrl+Alt+Delete key injection.

On successful Windows sign-in, terminate the sign-in worker and obtain fresh
authorization for the paired user's interactive host. Do not retain SYSTEM
control over another user's desktop. Reconnect progress must distinguish
restarting, waiting for Windows, sign-in available, signing in and connected;
only actual endpoint capability can make sign-in connectable.

## Completion evidence still required

Build the sign-in endpoint and authorization boundary first, then exercise a
designated administrator-approved second PC: cold boot before any sign-in,
owner connection, normal Windows credential entry, desktop handoff, restart,
fast restart, cancelled restart, console/session switches, network loss,
revocation while offline, Stop, held-key release, service crash/recovery,
upgrade/rollback and uninstall. Check attacker-controlled local paths/channels,
cross-account/helper denial and replay at the real OS/database boundaries.
No service installation or actual workstation reboot is part of local CI.
Until those changes and checks exist, full unattended access remains incomplete.

References: [DXGI DuplicateOutput](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput),
[interactive services](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services),
[CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw),
[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).
