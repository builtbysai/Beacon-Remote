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

| Scenario                               | Current evidence                                                       | Remaining acceptance                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Pending cancellation/disconnect/expiry | Loopback signaling and deadline checks                                 | Actual prompt closes, fresh request works                                    |
| Window cleanup/reused thread           | Real hidden-window queue regression                                    | Visible repeated request/deny/cancel sequence                                |
| Local Stop while connecting            | Noninput-desktop/expiry and Enter/Escape dispatcher regression         | Physical lock/unlock before peer connection, keyboard Stop and fresh request |
| Keyboard and readability               | Native default Decline, dialog navigation, DPI-scaled text implemented | Human Enter/Escape/Tab/close and normal/high-DPI checks                      |
| Desktop approval and Stop              | Historical owner Android/T-Mobile pass on earlier build                | Human Allow and local Stop with updated helper                               |
| Lock/display/network loss              | Lease and input-desktop guards; hidden desktop regression              | Actual interruption stops capture; fresh approval required                   |
| Refresh/logout/revoke/restarts         | Server authorization/recovery and helper lifetime checks               | Updated real-desktop interruption matrix                                     |
| Performance and routes                 | Historical direct/relay and synthetic measurements                     | Updated desktop startup, FPS, CPU/RAM, route and sustained behavior          |

The operator prepares/rechecks the bounded test backend and starts only the
paired native fixture when the person is ready. The person uses Windows
Decline/Allow/Stop and the Android viewer on mobile data. Never automate Allow
or treat a stored consent audit, synthetic stream or CI as desktop acceptance.

Milestone 4 is active. Five roadmap milestones remain: finish attended media,
then authorized input, resilient installation, consumer accounts/release, and
production UX/reliability. Implementation of milestones 5–8 is authorized in
that order after prerequisites. Signing, consumer release and production media
approval remain separate gates.
