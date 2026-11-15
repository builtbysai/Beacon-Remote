# How Beacon Remote is tested

Five layers, cheapest first. A change needs the layers that can actually catch its risk, not all of them.

| Layer                 | What it proves                                                                                   | Where it runs                      | Command                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| Unit                  | Pure rules (protocol, deadlines, path safety, token parsing)                                     | CI, any computer                   | `cargo test --workspace`, `pnpm --filter @beacon-remote/web test`     |
| Backend integration   | Authorization, ownership, invitations, revocation, cleanup against a real PostgreSQL             | CI, any computer with a `_test` DB | `TEST_DATABASE_URL=… pnpm --filter @beacon-remote/backend test`       |
| Local fixture         | The real programs against a throwaway local server, in a signed-in Windows session               | A Windows desktop                  | `apps/backend/scripts/support-development.ts`, `input-development.ts` |
| **Device acceptance** | The whole journey on a real second computer: download, run, approve, break, resume, clean up     | Two Windows computers (or one)     | `node scripts/acceptance/support.mjs …` (below)                       |
| Manual checklist      | What only a person can judge: look and feel, SmartScreen wording, real network changes, hardware | A person with the devices          | `docs/acceptance-checklist.md`                                        |

CI cannot run the last three: they need a visible Windows desktop (consent windows are real windows), a signed installer,
and for the second device a second computer.

## Browser-only appearance and Downloads review

For the full current Settings/email pass, first generate safe local previews with
`pnpm --filter @beacon-remote/backend exec tsx scripts/preview-mail.ts` after
entering the workspace. This generates only dummy-token HTML/plain-text files;
it creates no mailer, account or database connection. Then run the browser fixture
below. It now also covers section navigation, retained authenticator/recovery
state, session revocation/failure, team changes/failure, export completion/form
reset and deletion validation/failure/cancel against synthetic endpoints. Export
downloads are denied in that fixture; it does not prove a real saved export or
real deletion. All five Settings sections are reviewed across width/height sizes.
Dummy confirmation/recovery/existing-account/operational email previews are
rendered at narrow light and wider dark sizes. These Chromium previews do not
establish actual inbox delivery or Outlook/Gmail/mobile-client compatibility.

After `Enter-Workspace.ps1`, run `node apps/web/test-browser/appearance.mjs` with
the existing Chrome/Chromium (`CHROME_PATH` if needed). It runs the real React app
against synthetic loopback account responses in an isolated browser, without
accounts, hosts, OS settings or production access. It checks header/Settings
selection, persistence, pre-React initialization, live emulated system preference,
blocked storage, radio keyboard behavior, Escape/focus return, Tab/outside
dismissal, forced colors and desktop/phone/short viewport placement. Hit tests
check that navigation does not cover choices; geometry alone missed that defect.
Screenshots/result JSON stay in private local state until selected clean images
are catalogued. Zoom, screen-reader and real device/OS acceptance remain separate.

The same fixture supplies synthetic release manifests to the real shared Downloads
component. It checks published links/metadata, initially collapsed details, expanded
detail reflow, missing/error/retry/malformed/ZIP-only/loading states and public/
workspace shells. It neither serves nor downloads a real package; published artifact
integrity, signatures, install/trust and updates need separate acceptance. Release
decoder regressions also reject unsafe filenames, invalid sizes/hashes/dates and
malformed optional package/trust metadata.

## Pairing development checks

The design fixture also invokes `assist-review.mjs`: it holds synthetic support
code/queue/shared/guest grants, verifies cross-panel request exclusion, then
releases them after navigation or a deliberately failed sign-out. Each grant
must reach Stop and no viewer may open. Shared-list failures/retry and public
Security reflow are checked. This creates no real support session or native
capture/input. Existing pure viewer-request regressions remain a cheaper layer.

`test/enrollment-progress.test.ts` exercises the real local `_test` database for
owner/Origin isolation, one-use status, expiry, cancel/claim serialization,
failed-claim rollback, deleted-device status and cancellation under the legacy
expiry-only claim predicate. Migration 029 is additive and required before the
matching backend. Cancellation also lowers the original expiry so a backend
rollback cannot revive a cancelled code. No development/production DB is used.

The browser design fixture also calls `pairing-review.mjs` against synthetic
loopback enrollment endpoints. It checks exact code copy with an in-memory
clipboard stub (no OS clipboard writes), server-confirmed expiry, cancellation
failure/success, a claim winning cancellation, ignored stale waiting responses,
late issuance cleanup after close, status retry, unavailable codes, focus return,
inventory refresh and desktop/phone/short reflow. It does not pair a real host,
capture/inject input or raise any unattended gate. Navigation cleanup is best
effort when the network/session is gone; all codes retain the server's five-minute
expiry. Actual native persistence/installation and device acceptance remain open.

## Browser-only sign-in development fixture

After `Enter-Workspace.ps1`, set `CHROME_PATH` to an existing Chrome/Chromium
executable and run `node apps/web/test-browser/signin.mjs`. It creates its own
loopback Vite/API/WebSocket fixture and isolated headless browser. It does not
create accounts, open real enrollment identities, start the stopped acceptance
fixture or capture/inject OS content. The fixture deliberately reports synthetic
connectability; real backend/native gates remain false.

This exercises the actual React inspector/viewer, RTC canvas video, scoped
pointer/key bytes, clipboard exclusion, secure-attention request/reply feedback,
Stop and responsive viewport matrix. The secure-attention fixture covers
requested and policy-unavailable feedback without invoking Windows SAS. Vite's
fixture dependency optimization is refreshed so protocol edits cannot use stale
exports.

The fixture also opens a second sign-in reservation and transitions to a separate
ordinary RTC canvas producer. It asserts a fresh policy/context-bound desktop
request, rendered ordinary video, no unintended original-lease Stop during old
viewer cleanup, and working Stop after transfer. `handoff-desktop.png` and the
handoff result are synthetic browser evidence, not a Windows unlock or physical
capture/control result. The backend handoff regression separately uses real
PostgreSQL/WebSocket boundaries for endpoint proof, original-browser binding,
expiry, cancellation and overlapping Stop/consent/audit locks.

Secure-attention device acceptance remains separate and paused with the other
physical sign-in checks. On the designated installed second PC, verify existing
Windows policy allowing services, correct locked-console targeting and actual
Windows response to the viewer action. Repeat with policy missing/disallowing,
read failure, API unavailable, expiry, local Disable, browser Stop, worker loss
and console switch; none may broaden ordinary grants or target another session.
Check held-key/button release before the action and no delayed replay after a
blocked revalidation. A `requested` reply proves invocation only, so record the
visible Windows result separately. Any administrator/domain policy change is an
explicit local setup decision, never an automatic test or installer side effect.
The same fixture exercises actual restart confirmation, simulated offline/sign-in
readiness, automatic separate sign-in entry and a fresh ordinary desktop stream.
It checks Cancel at 1440×900, 360×640 and 844×390, then releases a delayed
readiness response after cancellation and verifies no new viewer or grant.
`restart-waiting*.png`, `restart-desktop.png` and the result's `osReboot:false`
explicitly distinguish this from reboot acceptance. The canvas producer uses
fixed-resolution encoding to match its declared metadata, as native encoded
frames must; lower-resolution frames remain rejected by product input guards.
Results/screenshots are written to `REMOTE_DEV_STATE_DIR/signin-browser-<UTC date>`;
representative sanitized captures are in `design/screenshots/validation/signin-browser`.
It does not establish real endpoint authentication, SYSTEM capture/input, full-screen
OS-shortcut delivery, screen-reader/mobile-keyboard usability or device acceptance.

## Device acceptance

## Local Windows sign-in settings

`scripts/Test-RemoteCi.ps1 -NativeOnly -SignInMedia` selects the opt-in native
variant; omitting that switch verifies the default-off build. Both retain the
same Windows/lease/peer/Disable boundaries. `beacon-remote-agent build-info`
reports only compiled capability and does not read an identity or service.
Do not infer physical acceptance from those checks or enable a live server.
The backend requires both `SIGNIN_AUTHORITY_ENABLED=true` and separate
`SIGNIN_MEDIA_ENABLED=true`, plus control/sessions and current local owner opt-in.
The normal local-development supervisor clears inherited flags. Real sign-in
acceptance requires its own isolated matching configuration and reviewed migration/
backup plan; the existing paused fixture remains paused.

`beacon-remote-host --sign-in-settings` opens the same settings as the paired
host's header/tray. Opening/Refresh only reads local state. Review unpaired,
missing owner control, absent/stopped/prepared/disabled service and failed
status/action states; verify that prepared service never claims working media.
Check narrow/short windows, long errors, Tab/Shift+Tab focus reveal, Escape,
owner focus restoration, enlarged text and DPI changes. Setup/re-enable and
removal hand off to actual Windows administrator approval; do not approve them
on the development workstation merely to inspect the view. Exercise those
mutations later on the designated isolated device with matching builds/backend.
Repair service must preserve local Disable and the existing backend binding,
including after interrupted repair and ordinary host upgrade/rollback. Only the
separate explicit Enable action may clear the local Disable marker/rebind access.

Native focused checks cover prerequisite/readiness presentation and a real
loopback HTTP server for the lower-only Disable proof and strict bounded reply.
Backend sign-in authority/handoff regressions cover separate credentials,
replay/freshness, disabled rollout and actual PostgreSQL/WebSocket pending and
issued handoff invalidation. Real service, disk failure, reboot, remote network
and physical input cleanup remain separate acceptance.

## Temporary-support device scenarios

`scripts/acceptance/support.mjs` runs scenarios for temporary support (ADR 0038 to 0040). It plays both people:

- **Technician**, on the computer you run it from, through the product's own API (sign-in, support links, chat, ending).
- **The person being helped**, through `scripts/acceptance/Device-Support.ps1`, which downloads the support program
  the way the Downloads page does, runs it, answers its question, presses its buttons, types in its chat, kills it, and
  reports what is left on the computer (folder, processes, startup entry, downloaded file).

Scenarios (each starts clean and ends clean even if it fails): the person ends support; the technician ends support; the
window crashes and support comes back; everything is killed and the restart entry brings it back; the local time limit
passes; a connection request asks the person and a view link refuses control; chat reaches both sides; sound is shared only when the person ticks it (this one opens a real browser: set `CHROME_PATH` or use Playwright's Chromium).

### On one computer (a local fixture)

```bash
cd apps/backend && pnpm exec tsx scripts/support-development.ts      # leave running; writes .remote-dev/support-development/login.json
# build a support program with a payload folder (see docs/input-development.md), then:
node scripts/acceptance/support.mjs --login .remote-dev/support-development/login.json \
  --installer <path to the setup exe> --server http://127.0.0.1:3011
```

### With a second computer

1. On the second Windows computer: Settings, System, Optional features, add **OpenSSH Server**, start it, and sign in
   once from this computer so `ssh user@host` works with a key. Nothing else is installed there.
2. Make a test account on the server under test (or use the fixture) and put its sign-in in a git-ignored file:
   `{ "origin": "https://remote.builtbysai.com", "email": "…", "password": "…" }`. Two-step accounts are not supported by
   the runner; use a test account without it.
3. Run:

```bash
node scripts/acceptance/support.mjs --login .remote-dev/prod-test-login.json --device ssh:user@host
```

With no `--installer` it downloads exactly what the Downloads page offers, so the signed installer, the file name and the
real server are all in the test. Windows will still show whatever it shows for an untrusted publisher on that computer; the
runner never changes trust. Add `--scenario "<name>"` to run one.

### Adding a scenario

Add an entry to `scenarios` in `support.mjs`. Use `start()`, the `device(action, …)` helpers and `waitFor`, finish with
`expectClean`. Add a new device action to `Device-Support.ps1` only if a person would do something it cannot yet (it must stay
limited to Beacon Support's own folder, processes and startup entry). Keep each scenario short and independent.

## What is still manual

Looking at the screens, SmartScreen and certificate prompts, a real restart or sign-out (the runner only runs the stored
startup command), network changes, sleep and resume, UAC and the lock screen, and anything with a second monitor or a
different GPU. Those stay in `docs/acceptance-checklist.md`.

## Temporary local sign-in

The owner authorized a temporary identity for development and later UI testing.
Dot-source `scripts/Enter-Workspace.ps1`, then use:

```powershell
pnpm --filter @beacon-remote/backend exec tsx scripts/temporary-account.ts create
pnpm --filter @beacon-remote/backend exec tsx scripts/temporary-account.ts status
```

The generated password is stored only at
`<BEACON_PRIVATE_DIR>/remote/local/accounts/temporary-development.json` under the
private root's restricted ACL. The command never prints credentials. It uses
only Remote's fixed loopback development database and `http://127.0.0.1:5174`;
it cannot provision a hosted/production account. `create` refuses to overwrite
an existing record. This is separate from the retained production test login
and the paused acceptance fixture. Do not copy it into Git or reports.

Keep it while development/testing is unfinished. At full completion use
`temporary-account.ts rotate` to invalidate browser sessions, or
`temporary-account.ts remove` to delete the recorded account, browser sessions,
enrolled disposable test devices and local credential file. Never enroll a
device identity that must be retained under this disposable account. A failed
rotation keeps an exclusive `.pending` recovery record; run
`temporary-account.ts recover` to reconcile it against the actual password hash
without displaying either password. Resolve a pending rotation before removal.
Uninstall/forget the disposable device installations before removing the account;
database deletion does not erase identities retained on the devices themselves.

Development checks of the new sign-in authority use a disposable schema in the
Remote `_test` database. They do not install services, launch sign-in workers or
resume device acceptance. See [the implementation boundary](signin-authority.md).
