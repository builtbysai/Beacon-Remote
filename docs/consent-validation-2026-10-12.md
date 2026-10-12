# October 12 attended-consent validation and test preparation

## Delivered code and checks

[PR #23](https://github.com/builtbysai/Beacon-Remote/pull/23) merged at
`fed694d1151e80197e652d43d5f293e3e15d0d0d`. Its reviewed head
`00135e251b9caf623276e166639a30c56bd5aba4` and merged main have identical
source trees. Required security/control-plane/native jobs passed at the reviewed
head in [run 38214868198](https://github.com/builtbysai/Beacon-Remote/actions/runs/38214868198)
and at merged main in [run 38215310190](https://github.com/builtbysai/Beacon-Remote/actions/runs/38215310190).
Local MSVC formatting, Clippy, native tests and optimized builds also passed.

The native prompt defaults to Decline, identifies the requester and remains
cancellable while signaling is read. Cancellation, disconnect, expiry and input
desktop loss deny sharing; the original monotonic deadline includes setup and
the person's response. Loopback WebSocket checks use no approval or capture.
See [the design decision](decisions/0013-cancellable-attended-consent.md).

A native-only follow-up fixes message-queue cleanup on a reused blocking thread.
Destroying a prompt before starting its pump previously posted a quit message
that could close a later request immediately. The hidden-window regression
exercises three successive destruction lifetimes on one real Windows thread;
only destruction during an active loop may queue `WM_QUIT`. No window is shown,
no consent is approved and no screen is captured. This changes no backend/web
source or database schema. That follow-up merged in
[PR #24](https://github.com/builtbysai/Beacon-Remote/pull/24) as `a68a430`, with
all three jobs passing on reviewed head `afe6935` in
[run 38236727411](https://github.com/builtbysai/Beacon-Remote/actions/runs/38236727411)
and merged main in [run 38237145830](https://github.com/builtbysai/Beacon-Remote/actions/runs/38237145830).

The next native resilience slice makes the local Stop window enforce the same
deadline and input-desktop boundary while the browser is still connecting.
Previously, a lock/unlock during that wait could be missed because capture had
not started checking the desktop yet. The window now clears active state and
closes on observed desktop loss or expiry, rejects unavailable initialization,
supports default-button Enter/Escape and Tab navigation, and destroys its native
window on a message-loop exit before releasing its state.

Local formatting, Clippy, native tests and optimized build passed. A real Win32
regression creates its windows on a temporary noninput desktop and dispatches
timer/keyboard messages through the production dispatcher while disconnected.
The old timer behavior fails; the guarded version passes for desktop loss,
expiry and Enter/Escape. The existing hidden-desktop test also verifies that
initial Stop-window creation is refused and active state cleared. There is no
desktop capture, physical desktop switch, system input injection or human consent
approval in these checks. Inspect the latest commit's hosted CI before using
its matching binaries; real lock/unlock and keyboard acceptance remains open.

## Isolated acceptance deployment

Source `00135e2` was exported from committed Git content. Archive SHA-256
`26e9f97dd99966b8c7630b7c7037c074f4e76399689bc0d3518def4a67ed70ff`
matched on Windows and Oracle before extraction. Both acceptance images were
built there and their image revision labels verified. Only the two existing
`beacon-remote-acceptance` application containers were replaced.

The versioned override is
`/etc/beacon-remote/acceptance-consent-00135e2.override.yaml`, applied alongside
`/etc/beacon-remote/acceptance-compose-20261010.yaml`. The protected existing
environment/login, separate `beacon_remote_acceptance_20261010` database and
restricted role were preserved. The predecessor backend was stopped before
replacement. Schema/role verification passed; no migration was needed or run.
The existing one-hour Node lifetime and `restart: no` remain in effect.

At 07:12 UTC on October 12, the test landing, `/health` and `/ready` returned
200, and unauthenticated `/api/machines` returned 401. Both production products'
health/readiness returned 200. Before/after image IDs and start times matched for
Remote backend/web/PostgreSQL, View backend/PostgreSQL, shared Caddy and Coturn.
Production Remote still has no session secret and viewing remains disabled.
No shared edge, relay configuration or production database was changed.

The acceptance backend exited cleanly at 08:12:15 UTC after its one-hour limit.
Later readiness must be rechecked, not inferred from this record. Resume only
these acceptance services with the same base plus versioned override. To undo
the application replacement, stop the acceptance backend and restore the web
using the base file alone; the predecessor backend was already stopped. Retain
all protected identity/database files and volumes.

Local native artifacts live under ignored `.agent-state/`; their manifests
record source revision and binary SHA-256. Keep agent and helper together.
`REMOTE_ACCEPTANCE_AGENT_PATH` selects the deliberately prepared pair when
running `scripts/android-acceptance-host.mjs`. The existing user-scoped DPAPI
identity is retained. The native fixture's STOP marker remains present; it was
not started and no new desktop session was requested in this pass.

## Remaining milestone 4 gates

### Owner acceptance with the PR #25 native pair

The owner reported that all guided tests worked after this chat prepared the
isolated acceptance backend and paired Windows fixture. The guided sequence
covered default Decline/Escape with no desktop frames, Android cancellation of
an open Windows prompt followed by a fresh request, manual Allow with actual
desktop video, and local Stop. The supplied images show the real consent and
connected Stop windows. The owner's feedback requests shorter copy, better
native visual design, and later one-time trusted-device setup.
In a follow-up, the owner also confirmed keyboard Stop worked, and explicitly
said lock/unlock, automatic expiry, refresh/logout and network loss were not
tested. The exact keyboard action was not specified; this is not evidence for
every Tab/Enter/Escape navigation path.

Native status corroborates connected desktop sessions stopping and other
requests ending as declined/cancelled/expired without capture. The status log
does not distinguish those three denial causes or prove Android frame delivery;
the owner's report supplies the human acceptance evidence. No pixels or
credentials were retained as runtime evidence. This report applies to source
`2aa1510eb69c80cb3d572ef2be7dbc8ed244bd45`, not subsequent UI changes.

The backend/web used the unchanged `00135e2` acceptance images. Resume at
12:37:25 UTC passed isolated origin/database/role, exact image labels, no published
ports, preserved relay/session configuration and one-hour shutdown-command
checks. Landing/health/ready returned 200; anonymous machines returned 401.
Remote and View production health/readiness returned 200, and image IDs/start
times matched for every protected/shared container. Production media remained
disabled. Protected baseline/receipt files are
`/etc/beacon-remote/acceptance-resume-20261012-chat13019-{baseline,receipt}.json`.

After the owner's report, both acceptance application containers were stopped;
the Windows runner exited and its STOP marker was restored. The original DPAPI
identity and private test login were preserved. The owner cancelled the hourly
continuation automation; it was deleted, with no replacement schedule.

Physical lock/unlock, automatic expiry, refresh/logout/revoke,
restarts, network/display loss, measured routes and sustained performance remain
unverified for this pair unless the owner supplies specific additional results.
Milestone 4 remains active and production media remains disabled.

### Compact native follow-up

The follow-up reduces consent/Stop client areas to 560×246 and 560×204 logical
pixels, respectively. Both use DPI-scaled Segoe UI and system text/background
colors, including high contrast. Requester identity is a read-only scrollable
field so a long account name remains inspectable. Consent retains focused/default
Decline, explicit Allow, view-only/primary-display/duration text and local
Stop/lock guidance. The Stop window has a remaining-time display derived from
the original monotonic deadline; its safety timer still runs every 100 ms while
accessible status text changes only when the displayed value changes.

Local Rust formatting, MSVC Clippy, native regressions and optimized build passed
for this follow-up; repository Prettier formatting also passed. Existing checks
cover real hidden-window destruction/queue reuse, noninput-desktop denial,
connecting Stop expiry and Enter/Escape, real loopback consent cancellation,
late replies and helper job termination. No human consent was automated and no
desktop was captured by validation. Backend/web/protocol/schema and production
deployment are unchanged; local control-plane tests were not rerun for this
native-only implementation. Hosted required CI must pass at the reviewed head
before merging.

The screenshots supplied by the owner show the predecessor layout, not this
follow-up. Updated native appearance, high-DPI/high-contrast and full keyboard
navigation need human verification. This compact revision is not the full
approved branded host/tray UI. Never claim those remaining appearance checks
from compilation or hidden-window regressions.

| Scenario                               | Current evidence                                                                           | Remaining acceptance                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Pending cancellation/disconnect/expiry | Owner passed Android cancellation and fresh request; loopback/deadline checks              | Actual pending-prompt disconnect and expiry                         |
| Window cleanup/reused thread           | Owner passed repeated request/deny/cancel sequence; hidden-window regression               | Broader lifecycle matrix                                            |
| Local Stop while connecting            | Owner passed keyboard Stop; noninput-desktop/expiry and Enter/Escape dispatcher regression | Physical lock/unlock before peer connection and fresh request       |
| Keyboard and readability               | Owner passed keyboard Stop; native default Decline and DPI-scaled text implemented         | Full Tab/Enter/Escape/close navigation and normal/high-DPI checks   |
| Desktop approval and Stop              | Owner passed manual Allow, actual Android desktop video and local Stop with PR #25 helper  | Updated compact UI and broader interruption matrix                  |
| Lock/display/network loss              | Owner confirmed Windows lock ends viewing and a fresh session is required                  | Display/network loss, pending lock and Stop-window closure on lock  |
| Refresh/logout/revoke/restarts         | Server authorization/recovery and helper lifetime checks                                   | Updated real-desktop interruption matrix                            |
| Performance and routes                 | Historical direct/relay and synthetic measurements                                         | Updated desktop startup, FPS, CPU/RAM, route and sustained behavior |

### Updated fixture: automatic expiry passed

The owner tested the `1d58a57` acceptance backend/web with the matching compact
`192a9c8` Windows pair after a bounded restart on October 12. They confirmed
sign-in succeeded, video ended, and the Windows Stop window closed after two
minutes, with the session expired accordingly. Fresh native output corroborated
a local-consent-required request, connecting/connected peer states and desktop
sharing stopping. The isolated backend enforces relay-only ICE policy. No
consent was automated. This records automatic expiry on that Windows/Android
path; exact selected-candidate, FPS/RTT and resource measurements are not inferred.

The earlier sign-in failure occurred after the test backend's one-hour limit;
the sign-in page remained available. A bounded restart and private verification
of the saved test login resolved it without changing credentials. Production
media remained disabled and both products' health/readiness passed.

Updated UI readability/navigation, refresh/logout,
network loss, pending-prompt expiry, revocation/restarts and broader performance
remain pending. Milestone 4 is still active.

### Updated fixture: lock/unlock passed

On the same updated fixture, the owner confirmed that locking Windows ended
the session and connecting again required starting a new session. This records
physical lock termination and fresh-request recovery; unlocking did not restore
the ended view. The reply did not separately confirm Stop-window closure during
lock, prompt behavior before connection, or UI readability. Those details remain
open. No consent or Windows lock/unlock action was automated.

The owner requested seamless recovery after lock and restart for the future
remembered personal-device mode. That direction is recorded in ADR 0014; current
attended sessions still require fresh local approval.

### Refresh feedback and recovery follow-up

The owner confirmed refreshing Android disconnected the updated test view, then
rejected that behavior: refresh should preserve an active session. This records
the observed interruption and changed product requirement, not acceptance of the
new recovery implementation. ADR 0015 describes a bounded reload window within
the original consent/deadline, with capture stopped while the viewer is absent.
Matching backend/web/helper deployment and real Windows/Android reload playback,
original expiry, local Stop during recovery and lock/logout/revoke boundaries
must still be verified. The old compact `192a9c8` helper does not advertise this
recovery capability.

The owner connected a dedicated Pixel 7a for Remote. Claude uses a separate
Android emulator. Device commands must pin the observed Pixel serial; do not
reset the shared ADB server or operate on the emulator. USB approval succeeded;
the attempted browser/CDP setup command was blocked by execution policy before
running. Device inventory is not browser-automation or media acceptance evidence.

The operator prepares/rechecks the bounded test backend and starts only the
paired native fixture when the person is ready. The person uses Windows
Decline/Allow/Stop and the Android viewer on mobile data. Never automate Allow
or treat a stored consent audit, synthetic stream or CI as desktop acceptance.

Milestone 4 is active. Five roadmap milestones remain: finish attended media,
then authorized input, resilient installation, consumer accounts/release, and
production UX/reliability. Implementation of milestones 5–8 is authorized in
that order after prerequisites. Signing, consumer release and production media
approval remain separate gates.
