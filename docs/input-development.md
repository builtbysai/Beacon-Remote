# Development input acceptance

This is an isolated unsigned development build, not a consumer release. Production
viewing/control remain disabled. Start Docker's existing Remote PostgreSQL and
build matching Windows binaries using `scripts/Test-RemoteCi.ps1 -NativeOnly`.

```powershell
pnpm --filter @beacon-remote/backend exec tsx scripts/input-development.ts
```

The fixture refuses occupied ports rather than reclaiming them. It listens only
on 127.0.0.1:3011/5175, creates a disposable schema in `beacon_remote_test`, makes
a temporary test account, enrolls a fresh in-memory Ed25519 host through the real
pairing API and signs heartbeats. It launches the matching native helper only when
a request exists. Login details are in ignored `.remote-dev/input-development/login.json`;
never copy that file into evidence or Git. The fixture runs until explicitly stopped
and reuses those local demo credentials across restarts. Active sessions have no
fixed duration. A pending request still requires approval
within two minutes. If a prior
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
the helper stops when its short authorization renewal expires. Forced process death
is not proof of held-state cleanup. Do not use this fixture for sensitive documents.

Automated validation protects scope/token isolation, single controller, consent
audit, disconnect consumption, held-state cleanup and physical coordinate mapping.
Those checks and successful builds do not establish actual Windows input or
cross-network control acceptance.

## October 12 local acceptance

With the owner signed in and manually approving control, computer use selected
Remote and operated the streamed test window. The fresh native counters recorded
two clicks and one drag movement. The session remained connected beyond two
minutes with Until stopped visible. Browser Stop control closed the viewer,
the native helper exited, and the database recorded desktop:control as ended.

Scrolling recorded no wheel events and typing was not completed. Viewer and host
shared one Windows input desktop: remote clicks activated the native target,
causing Chrome to lose focus and release input. Browser automation could not
attach because its request-header policy failed to load. Full drag, wheel,
keyboard/modifier and held-input cleanup acceptance requires a separate viewer
device or functioning browser automation; these are not marked passed.

Failed SendInput key/button releases are retried for up to three seconds on the
ordinary input desktop after session authority has ended. A persistent UIPI/lock
block or forceful process death can still prevent release; the helper reports
that failure and never revives control. This remains an unverified release gate
requiring an elevated-window/lock held-input acceptance test and a durable cleanup
owner in the installation track.

## Android host against this fixture

`apps/android-host` pairs to the fixture at `http://10.0.2.2:5175` from the emulator (cleartext to that address is
allowed in debug builds only). The emulator cannot reach the browser directly, so run a local relay and tell the
fixture about it:

```bash
docker run -d --name remote-dev-turn -p 3480:3480/udp -p 49300-49310:49300-49310/udp --entrypoint sh coturn/coturn -c \
  'ip=$(hostname -i); exec turnserver -n --listening-port=3480 --min-port=49300 --max-port=49310 --realm=dev.local \
   --use-auth-secret --static-auth-secret=<32+ character development secret> --relay-ip=$ip \
   --external-ip=<this computer'"'"'s LAN address>/$ip --no-tcp-relay --no-tls --fingerprint --no-cli'
DEV_TURN_URLS="turn:<LAN address>:3480?transport=udp" DEV_TURN_SECRET=<same secret> \
  pnpm --filter @beacon-remote/backend exec tsx scripts/input-development.ts
```

Build with `JAVA_HOME` set to Android Studio's `jbr` and run `gradlew.bat :app:assembleDebug` from
`apps/android-host`. Pairing codes come from `POST /api/enrollments` as the signed-in test account.
