# Development input acceptance

This is an isolated unsigned development build, not a consumer release. Production
viewing/control remain disabled. Start Docker's existing Remote PostgreSQL and
build matching Windows binaries using `scripts/Test-RemoteCi.ps1 -NativeOnly`.

```powershell
$env:REMOTE_DEV_CONTROL = 'true'
pnpm --filter @beacon-remote/backend exec tsx scripts/input-development.ts
```

The fixture refuses occupied ports rather than reclaiming them. It listens only
on 127.0.0.1:3011/5175, creates a disposable schema in `beacon_remote_test`, makes
a temporary test account, enrolls a fresh in-memory Ed25519 host through the real
pairing API and signs heartbeats. It launches the matching native helper only when
a request exists. Login details are in ignored `.remote-dev/input-development/login.json`;
never copy that file into evidence or Git. It expires after 15 minutes. If a prior
STOP marker exists, remove it deliberately before a new run.

1. Open `http://127.0.0.1:5175`, sign into the generated development account, and
   inspect the computer. **View only** and **Remote** request different scopes.
2. Open a blank Notepad document for input acceptance. Use a separate viewer
   device/browser where practical to avoid a recursive same-screen view.
3. Select **Remote**. On Windows, inspect the requester and mouse/keyboard scope,
   then manually click **Allow control**. No script approves the native prompt.
4. In the viewer, click the video to focus. Move/click left/right/middle, drag a
   text selection, scroll, type and try Shift/Ctrl combinations in the blank test
   document. Record actual behavior, including DPI scale and display dimensions.
5. Hold a modifier/button and use local **Stop sharing**, then verify it is
   released and further viewer input does nothing. Repeat with viewer closure,
   expiry, loss of network, device revoke and Windows lock. Each control
   reconnect requires a fresh request and local approval.
6. Verify a view-only session cannot control Windows. Verify an elevated target
   is not controlled from the unprivileged helper; no UAC/secure-desktop bypass.
7. Press Escape in the viewer: input releases and the video loses focus. Browser
   and OS-reserved shortcuts may stay local. Touch/IME and multiple displays are
   not yet accepted; only primary-display mouse/scan-code input is implemented.

Use Ctrl+C in the fixture terminal, or create
`.remote-dev/input-development/STOP` to stop it. It closes the backend/helper and
Vite, then removes only its generated disposable schema. After a process crash,
the helper still has its original two-minute deadline, but forced process death
is not proof of held-state cleanup. Do not use this fixture for sensitive documents.

Automated validation protects scope/token isolation, single controller, consent
audit, disconnect consumption, held-state cleanup and physical coordinate mapping.
Those checks and successful builds do not establish actual Windows input or
cross-network control acceptance.

Failed SendInput key/button releases are retried for up to three seconds on the
ordinary input desktop after session authority has ended. A persistent UIPI/lock
block or forceful process death can still prevent release; the helper reports
that failure and never revives control. This remains an unverified release gate
requiring an elevated-window/lock held-input acceptance test and a durable cleanup
owner in the installation track.
