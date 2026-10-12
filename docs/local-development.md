# Beacon Remote on the shared Windows workstation

Remote and View are independent repositories, databases and runtime owners.
Keep the current Windows paths stable while both agents are working.

| Resource                 | Beacon Remote                                       | Beacon View (owned by Claude)                                                 |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Checkout                 | `C:/Dev/Beacon-Remote`                              | `C:/Dev/Beacon-SecureView`                                                    |
| Registered worktree      | None added                                          | `C:/Dev/Beacon-Desktop` — preserve Git registration                           |
| API / web                | 127.0.0.1:3010 / :5174                              | 127.0.0.1:3000 / :5173                                                        |
| Local database           | 127.0.0.1:5433, `beacon-remote-dev` Compose project | :5432, `beacon-secureview-local` project                                      |
| Test database            | `beacon_remote_test` in Remote PostgreSQL           | View-owned independent test DB/container; observed :5544 during Claude's work |
| Runtime logs / ownership | `.remote-dev/`                                      | `.beacon-dev/`                                                                |
| Native test artifacts    | `.agent-state/`                                     | View's own tooling; never repurpose                                           |
| Production origin        | remote.builtbysai.com                               | beacon.builtbysai.com                                                         |

These are explicit reservations, not permission to stop a listener. Vite uses
strictPort: it fails rather than silently moving onto another project's port.
Backend binds 3010 strictly. Do not change View's launchers, state, working tree,
test container, worktree or uncommitted patches to make Remote run.

## Start and stop

Prerequisites: Node 22.13–22.x (observed 22.22.0), pnpm 11.9.0 and running Docker.
From the Remote repository:

```powershell
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev:start
pnpm dev:status
pnpm dev:stop
```

Setup starts only Remote's Compose PostgreSQL, applies its local migrations and
verifies its schema. Start launches the actual backend and Vite in hidden child
processes; it waits for HTTP readiness and writes logs under `.remote-dev/`.
Use normal private local account provisioning described in README for login.
It does not provision account credentials automatically or start desktop capture.

The launcher pins the Remote loopback database/origin/ports and strips media/
relay/proxy-trust configuration inherited from a shell used by View or staging.
Media is disabled in this ordinary local environment. Explicit media acceptance
uses the separately prepared native fixture. No production database is selected.

Stop writes a request addressed to this launcher's run UUID. The supervisor kills
only the original child handles it owns; it never uses saved PIDs to kill a
process, scans for Node processes to stop, kills a process tree or stops Docker.
An occupied port causes startup failure, not reuse or reclamation. PostgreSQL
and all View processes survive Remote stop. No automatic OS service/autostart.
Local dev uses direct TS execution; restart explicitly after backend edits.

After forcibly killing the supervisor, an owner file and its local children may
remain. Status reports the supervisor PID for diagnosis only. Inspect named
Remote commands/listeners before manually stopping them or archiving stale owner
state; the launcher refuses ambiguous ownership and never kills a recycled PID.
Do not delete a live owner's `.remote-dev/owner.json`. Watch log files without
publishing credentials or request bodies.

## Tests and native fixture

`pnpm --filter @beacon-remote/web test` runs the focused browser-playback
lifetime, pending-request context and clock-adjustment expiry regressions with the same pinned `tsx`
tooling already used by the backend. It is included in `pnpm check`. These checks start no
browser/native capture or consent prompt; actual Windows/Android playback and
interruption acceptance remains separate.

Backend test files run serially because they initialize a shared test schema.
Individual tests still exercise concurrent invitation/enrollment requests and
signaling peers. Validate against an empty `_test` database when changing schema
or fixture initialization; an already initialized database can conceal DDL races.

For GitHub runner unavailability, run
`pwsh -NoProfile -File scripts/Test-RemoteCi.ps1`. It reproduces the control-plane
checks and, with installed MSVC/Windows SDK, native formatting/Clippy/tests/release
builds. `-ControlPlaneOnly` explicitly excludes native compilation/tests and is
not full native CI. `-NativeOnly` runs only native formatting/Clippy/tests/release
builds; the two switches are mutually exclusive. Use it when only native source
changes need verification. The required `_test` database must already exist for
control-plane checks. No runner
installation, billing changes or shared View environment changes are performed.

```powershell
$env:TEST_DATABASE_URL='postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test'
pnpm check
pnpm audit --prod --audit-level high
cargo fmt --all -- --check
```

Create the separate `_test` DB once if absent, using Remote's database container.
Do not reuse View's tests/database or a production database. Native builds require
MSVC/Windows SDK; local linker absence still requires matching Windows CI.

`scripts/android-acceptance-host.mjs` replaces the archived loose runner. It
defaults to the owner-private fixture directory under the user's home and the
matched `.agent-state/android-acceptance-0979cd1` binaries. Optional
`REMOTE_ACCEPTANCE_STATE_DIR`/`REMOTE_ACCEPTANCE_AGENT_PATH` select another
deliberately prepared fixture. Existing DPAPI identity skips re-pairing. STOP
marker must be deliberately removed before start. It has a 45-minute runtime,
private login only if pairing is needed, visible native consent/Stop, two-minute
grants and no automated desktop approval. Run only after preparing the isolated
Oracle acceptance services; see the operations supplement. Normal owner identity
is never overwritten.

Before each manual session, run `pnpm acceptance:status`. This read-only command
requires `/ready` to return 200 and anonymous `/api/machines` to return 401 on
the fixed test origin. It reports STOP-marker/identity presence without reading
the private login or DPAPI contents. The host runner now performs the same
backend check before pairing or launching a native process. A reachable web page
alone is insufficient: the bounded backend can expire while the page remains
available. Failure never restarts services or changes credentials automatically.
Readiness is a point-in-time check, not proof of a remaining runtime budget,
matching binaries, live agent, relay allocation or successful sign-in. Continue
the guarded image/hash/runtime procedure in the operations supplement.

For a dedicated USB Pixel, enable Developer options and USB debugging, connect
and unlock the phone, then manually approve this computer's debugging prompt.
Set `REMOTE_ACCEPTANCE_ADB_PATH` to the installed platform-tools `adb.exe`, or use
`ANDROID_HOME`/PATH, and run `pnpm acceptance:status --adb` to list device states.
No device input is sent by this command. Before any future automated device
actions, explicitly select the observed device serial with `adb -s`; never
assume the first device belongs to this test. Keep browser automation scoped to
Beacon Remote's test origin/account and keep private login, browser cookies,
screen pixels and broad device logs out of committed evidence.

USB connection supports repeatable Android browser/lifecycle checks and targeted
diagnostics; it does not prove mobile-data relay routing. Keep Wi-Fi/mobile-data
route evidence explicit. Windows attended Allow remains a human action; automated
backend/browser/native regressions and synthetic media cannot replace actual
desktop acceptance. Use a dedicated test computer or VM later for disruptive
restart/network cases rather than altering the shared View workstation. No
hourly continuation schedule is used.

Active-view reload recovery requires a matching backend/web/native pair; see
[ADR 0015](decisions/0015-active-viewer-reload-recovery.md). An older helper keeps
the previous disconnect behavior. The browser keeps a tab-local identifier;
resuming still validates the original login, current helper and unchanged
deadline. Include real refresh/Stop/lock/expiry checks when staging that pair.
The native loopback recovery regression opens no consent dialog or capture.

## Shared infrastructure contract

Oracle Caddy and Coturn remain shared operational dependencies. Shared edge/TLS,
TURN ports, public VM, relay peer protections, free-tier quota and original View
Compose are not Remote-owned. Independent databases/account identities/REST
origins never imply shared access. Ordinary local start/stop touches neither
shared Oracle service. Remote changes must retain the documented relay override.
Coordinate any shared-service deployment with the owner/Claude and verify both
products; never apply the View Compose wholesale for a Remote app change.

Production relay ownership is still split: View's Compose project/configuration
uses a Remote-owned patched image/wrapper override. Live inspection found the
updated local View peer-denial policy and quotas are not deployed. Follow
[the relay separation decision](decisions/0011-independent-relay-ownership.md)
and [maintenance runbook](relay-separation.md); local environment separation
does not mean the live relay has already been separated or hardened.

## Cleanup and retained material

Validation on October 11: full formatting/lint/type checks, real Remote
PostgreSQL regressions, backend/web builds, dependency audit and native formatting
passed locally. Actual launcher start/readiness/stop and occupied-listener
preservation passed. Both production products' HTTPS health/readiness passed.
PR #11 CI could not start: GitHub reported an account payment/spending-limit
block, before any job steps. No billing settings were changed. Keep that distinct
from a source/test failure. The owner then explicitly authorized local CI/manual
deployment and merging PR #11; it is merged and production updated with media
disabled. See validation-2026-10-11.md. Rerun hosted CI when account access returns.

October 11 cleanup moved old loose `beacon-remote-*`, Coturn research and
`beacon-view-*` root artifacts into `C:/Dev/Archives/2026-10-11` by product and
Evidence/Tools/Packages/Notes. The restricted local `manifest.json` records every
original path, destination, bytes and SHA256; all moved contents were reverified.
There was no deletion. These archives may include sensitive historical material,
so owner/SYSTEM access is retained; they are not Git content.

Registered `Beacon-Desktop`, `Beacon-Omarchy-Handoff` (including secret migration
instructions), approved `Beacon-Remote-Design-Review`, the owner's Downloads ZIP,
all paired identities, recovery DPAPI material, dependency/build caches and
database volumes remain intact. Ambiguous old release archives/install logs stay
at root until ownership is proven. `Beacon-OldMain` contained only orphaned
dependency trees and no Git checkout or active process references; it was
preserved at `C:/Dev/Archives/2026-10-11/Legacy/Beacon-OldMain`. The directory
receipt is `legacy-directory.json`; none of its contents were deleted.
Before deleting merged Remote local refs, a verified complete Git bundle at
`Beacon-Remote/Notes/pre-cleanup-local-refs.bundle` preserved all branches and the
unfinished handoff stash. Useful operational details are now in the supplement;
no uncommitted work is hidden by dropping the stash.
View's active checkout was inspected only and left to Claude. The workspace
inventory in `C:/Dev/WORKSPACE.md` lets both agents find current projects and
recover old artifacts without editing each other's repository.
