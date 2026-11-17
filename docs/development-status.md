# Development status

## Latest handoff — November 17, 2026, evening

Use the [RDP/VNC parity plan](rdp-vnc-parity-roadmap.md),
[remaining-test ledger](testing-remaining.md) and [next-chat handoff](next-agent-handoff.md).
The owner changed this chat to a documentation/handoff task; no additional feature
implementation or device testing is required by that final request.

Rotation's cause is now established: ordinary input routed any later channel
message to clipboard handling, rejecting updated display geometry and closing
the viewer. `c22dc2f` discriminates clipboard replies before allowing geometry
validation/remapping. Regressions reproduced the failure before the fix and
passed afterward; web typecheck/lint/suite/build/format passed. A real Pixel
unattended session stayed live across portrait/landscape/portrait, with observed
324x720/720x324/324x720 frames, exact landscape typing and a remapped far-right tap.
The test used owned-browser local compiled static assets against the actual
isolated backend; API/authorization responses were not replaced.

Accessibility revocation during that session ended control/video and removed
capture. Re-enabling accessibility did not enable standing access; a fresh request
required approval and was declined, with terminal/profile cleanup confirmed.
The stale earlier enabled notice was separately corrected in Android `1afcc9e`;
unit/lint/signing passed and repeated real revoke displayed the new off message.
The same-signer update preserved pairing. A later real Beacon 3 MiB transfer
reported Sent and matched the Pixel file's SHA256; the benign test file remains.
All completed connected runs were ended and their owned profiles closed.

Application HEAD before this documentation update is `1afcc9e`. Its exact CI run
`44144389550` passed Android/native/security and functional control-plane checks,
but failed dependency audit. Production remains `5e8d5c5`. The isolated backend's
one-hour run has expired; its image is `8af1c43`, web remains `0bba353`. Automatic
approval review rejected replacement by the built `c22dc2f` image with only
“blocked by policy”; the denied command was not retried by another route.
Newer APK `dist/BeaconRemoteHost-1afcc9e3.apk` SHA256 is
`7985f06318ed409c1b0a1cd0872d2bd3b9aa0f6e6087f08fe900f5c459fd9912`.
It is installed locally but still needs private VM staging. No public feed changed.

At the evening documentation inventory the Pixel was unlocked, availability on,
capture off and accessibility off. Restoration had not been confirmed; the owner
may use the phone between calls, so never replay old coordinates without observing
the current screen. The owner-supplied development unlock credential is sealed
outside Git; its location and bounded continuation steps are in the handoff.

## Earlier November 17 Pixel automated acceptance

The Pixel 7a is paired to the isolated account using the new readable invitation.
The installed same-signer Android candidate is `d329066`; the isolated backend
runs `8af1c43`, the isolated viewer runs `0bba353`, and production remains
`5e8d5c5`. Actual Pixel view-only video and
viewer Stop passed on November 16: 576x1280 decoded video, relay/relay, 65 ms RTT,
1467 ms approval-to-first-frame; capture stopped while availability remained on.
This was a short sample, not sustained performance acceptance. No viewer input
was injected in that view-only test.

The owner explicitly authorized unattended ADB testing and ordinary Android UI
permission setup. Beacon accessibility is enabled; no other service was changed.
Physical control testing exposed a duplicate-delivery bug: idle responses cleared
`handled`, causing a pending request to reopen and dismiss Android's capture
dialog. The fix retains the delivered request across idle polls and defers a new
request while an earlier capture is stopping. Unit regressions, Android lint and
same-key signing passed. On the actual Pixel, the Android screen-sharing dialog
remained open for 41.399 seconds across idle polls and could then be approved.

Control acceptance initially failed with TURN error 486 before the viewer gathered
a relay candidate. A single diagnostic allocation using the actual session's
credentials succeeded and was released; this did not establish the root cause.
Android now bundles media/control on one ICE transport; the viewer also bundles
and no longer gathers eagerly before approval. With both candidates installed,
actual attended control passed: 576x1280 video, relay/relay, first presented frame
853 ms after approval, and observed RTT 50–65 ms in the short sample. Browser
mouse events toggled Connection details on the phone; browser key events typed
the exact test word into Android Settings search. ADB only arranged/observed those
targets, rather than supplying the tested input. Local notification Pause reached
the viewer, Resume restored viewing, and local Stop ended the session and removed
CaptureService while AvailabilityService remained. This does not establish
paused-input rejection, sustained frame rate or all keyboard/gesture mappings.

The first real unattended owner test also passed without another Beacon or
MediaProjection prompt: 324x720 accessibility video, relay/relay, first picture
2032 ms after viewer setup (971 ms after automatic approval), and a verified remote
tap. Turning unattended access off locally ended that live connection, removed
capture and left availability on. A subsequent request required fresh local
approval with optional permissions off; Decline ended it with no video/control.
The private fixture's cleanup assertion expected `ended` and rejected the valid
`denied` terminal status in this refusal test; that assertion is not a product
failure or a successful control test. Successful connected runs confirmed backend
end and owned browser-profile cleanup.

Repeated unattended connections passed; a competing controller was refused with
HTTP 409. A later unattended Pause test kept the decoded-frame count at 141 and
blocked the test word in a focused empty Settings field. After local Resume,
frames advanced and the same browser key sequence produced the exact word.
Locking the real phone ended the session with the local locked/permission reason;
the viewer ended with input disabled and CaptureService absent, while availability
remained on. The device reported keyguard showing and input restricted. No unlock
or lock-screen input was attempted; owner PIN/fingerprint is needed to continue.
Standing access was re-enabled for these tests and currently remains enabled on
the locked isolated-test pairing. Restore the intended local setting after unlock.

Rotation acceptance failed twice: after the real display changed to landscape,
the viewer ended, once with local `Authorization lapsed` and once `Connection lost`;
the Android signaling log reported Broken pipe. Automatic rotation was restored
to its original `free` mode. Fresh portrait connections passed again, including
the longer paused/resumed test. Do not infer a rotation root cause or change lease
limits from this evidence. Diagnose display-change timing and signaling/network
lifetime before marking rotation accepted. Permission revocation, network recovery,
files and wider lifecycle acceptance remain open. Full unattended release acceptance
is not complete.

Exact-head CI run `44135128255` passed the functional control-plane checks,
Android, native and security jobs, but its dependency audit failed on the newly
updated high-severity picomatch advisory GHSA-fc5q-39xc-vjpf. On November 17 the
official registry still publishes 4.0.7 and rejects 4.0.8; GitHub lists no patched
version. A normal recursive update made no lockfile change. Keep the release gate
open; no audit exception was added. The isolated viewer image was checksum-verified
and deployed for these tests, with protected production container IDs/images
unchanged and all three readiness endpoints returning 200.

The tested `d329066` APK (SHA256
`0649b3e2a75098d5198506a76f344e92431c80a22b48bd94f4c62fb5c589f084`)
is hash-verified on the VM in a root-only candidate directory (0700; APK 0600).
The `aff4f34` source archive and extracted acceptance documentation are also
verified there. Neither staging operation advanced a native feed or production
release. Temporary test credentials remain protected for the unfinished tests.

Do not use stock `uiautomator dump` during accessibility/capture acceptance: its
automation connection can suppress services and contaminate the result. Use ADB
screen snapshots for physical observation. Existing guarded emulator runners use
`FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES`; never run those emulator-only setup
runners on the owner's phone. Two setup attempts ended denied before video;
they are not successful control evidence. Keep automatic test runs bounded and
rotate/delete temporary credentials only after full completion.

Current checkpoint: November 16, 2026. PRs #115-#117 and #124 are merged; VM application
source `5e8d5c5` is deployed. The [completion checklist](completion-checklist.md) records
publication, encrypted recovery, migration and browser/MCP verification. Older
dated entries below are historical, including their local-only release statements.

## November 16 isolated device acceptance and startup latency

The paused acceptance environment now uses verified backend/web application
source `5e8d5c5`, the existing separate acceptance database/role and protected
session/relay configuration. Its old empty account baseline was encrypted to the
independent C: repository, restored and checksum-checked, then recovered into a
new local disposable database before migration. Production databases were not
used for tests. Current schema/role verification passed; only the acceptance
services were started, with the existing one-hour backend lifetime. Remote/View
production container IDs, images and start times stayed unchanged. Ordinary view/
control is enabled only in acceptance; sign-in authority/media remain disabled.

A fresh random temporary acceptance account and browser session are stored under
the existing external private root. The password and prior Pixel APK were also
independently encrypted/recovered. Actual sign-in, secure HTTP-only SameSite
cookie, empty account scope, wrong-password refusal, cross-Origin refusal and
anonymous enrollment refusal passed. No actual password, cookie or pairing code
is recorded here. Rotate/delete this account and retained sessions at full completion.

The Pixel 7a (API 37) candidate update used the same verified APK signer and
preserved installed app data/identity. Surfiena's signed default candidate
`a6d114d` was hash/signer/timestamp verified in a separate private fixture; its
Ed25519 key was generated/sealed on Surfiena. An explicitly limited interactive
task launched the host in signed-in session 1. No installed identity, service,
certificate store, Windows startup entry or system permission was changed.
The old local acceptance STOP marker/identity remained untouched. The owner
started the host locally, reported Online was slow, and approved a real view-only
request; the owner reported that approval prompt appeared promptly.

Actual native WebRTC viewing and browser Stop passed. Decoded frames advanced
from 2 to 134 over the 15-second sample; the adaptive picture changed from
1280x720 to 960x540. Selected candidates were relay/relay, with measured RTT
124-191 ms. Approval-to-first-presented-frame was 5209 ms. Approval timing includes
the person's response and is not prompt arrival latency. This mostly static,
brief desktop sample is not sustained-FPS or subjective-picture acceptance.
No pixels were saved, recording started or input injected. Backend session end
and owned browser-profile cleanup were verified (`windows-view-result.json` in
the private preparation directory).

The first host request currently uses a 15-second long poll before publishing
Online. Follow-up source now requests an immediate signed acknowledgement for
startup/recovery, then opens the long poll without an intervening 15-second idle
sleep. Established connections preserve server backoff and existing authorization.
A real loopback HTTP regression verifies readiness before work arrives and that
the following request is already listening. Recovery/idle-backoff regressions
also pass. A timing-only log line supports the next actual-device measurement;
it contains no identity, grant, screen or input data. Full native checks, signing
and the signed `9d377c6` candidate passed. Surfiena recorded its first successful
acknowledgement in **208 ms**; the owner confirmed "Online quickly now." This is
startup acknowledgement evidence, not a completed media-performance result.

The owner's follow-up UI review requested one Start/Stop control, applicable
actions only, and no blank terminal window. Follow-up source uses one primary
host toggle, shows its stopping/pairing progress, hides file permission until
trusted access is on, and removes the setup shortcut once its settings are already
complete. Revocation/repair remain reachable. The sharing helper uses
`CREATE_NO_WINDOW`; a real console-child regression passes without suppressing
consent/sharing windows. The test fixture also launches its bounded PowerShell
wrapper through the inbox windowless script host because an early console can
otherwise trigger Windows Terminal. Signing passed: ordinary candidate `d3bd11c` is signed, hash/signer/
timestamp-verified and running as the limited user in Surfiena session 1 with
the same private profile. Both native configurations and all four GitHub jobs
passed (run `43925818548`). Source and ordinary signed ZIP/installer are also
checksum-verified on the VM, outside public feeds. The owner confirmed Start
changed to Stop and no new blank terminal appeared. Its first acknowledgement
was 252 ms. A second real view-only session decoded advancing video, stopped and
cleaned its browser profile. It used relay/relay, measured 92-247 ms RTT and
11800 ms approval-to-first-frame. Native timing showed a 99 ms offer setup,
3033 ms peer connection and 4706 ms first outgoing packet. These are separate
clock/stage measurements, not a proof of the remaining delay's cause. Media
startup performance remains open. No input or pixels were retained by this view test.

The owner saw connection-time window blinking once, then none on the repeat;
its source is unresolved. Per the owner, defer further design choices until
core acceptance. An initial control attempt never became input-ready and ended
without injecting input. The harmless input-test window also encountered a
state-file sharing violation; its snapshot writer now preserves the previous
complete snapshot and retries after a reader releases it. A real held-reader
regression verifies refusal without damage and subsequent recovery. This was
a test-fixture failure, not evidence that actual control works. A visible isolated
viewer is open for an owner handoff; control and key-release acceptance remain open.

After a deliberately bounded acceptance-backend restart, the earlier candidate
logged a 15410 ms recovery sample including network retry/backoff. Do not treat
the 208 ms initial acknowledgement as an all-reconnect latency guarantee. The
restart had no active sessions; acceptance readiness recovered after a transient
502, and both production products remained ready.

The maintained Windows fixture refuses other devices, checks pinned archives/
signers, retains versioned binaries, preserves its on-device profile and never
approves local consent. Its generated limited launcher and wrong-device guard
have a separate regression. It uses bounded owned processes/tasks and requires
explicit resume of its own STOP guard. Existing broad automated consent actions
in the older temporary-support fixture were not used.

## November 16 Android pairing and further permission requests

November 16 follow-up: the owner requested additional permissions from a live
view-only session (control/files/audio/recording). This is an implementation gap;
increasing access must require fresh local approval and preserve input release
and single-controller rules. It has been added to the roadmap. Windows testing
was set aside while the owner charges the laptop; the owned visible viewer was
closed with session/profile cleanup confirmed.

Pixel testing found the installed app unpaired, accessibility off. Automatic
approval review rejected ADB entry of its server/pairing fields with "blocked by
policy"; no alternate automation route was used. The owner is entering pairing
details manually, with the code shown only in a local isolated browser. Source
inspection then found a real blocker: the app uppercased the case-sensitive
base64url code. The fix preserves case/keyboard entry and changes the guarded
dummy-emulator enrollment regression to a mixed-case 32-character code.
Validation/signing/update and actual pairing remain in progress.

Android `b17549a` passed unit tests, lint, debug/instrumentation builds and an
existing-key release build; all four GitHub jobs passed (run `43932341191`). The
APK SHA-256 is `fcc21fa4327d3ad38b5eed76b76568dca3d1b89108220eb0c14ab9f3ce2de774`.
Its signer matches the installed app. `adb install -r` succeeded with capture
inactive, without clearing data. The guarded read-only emulator did not finish
cold boot within the bounded readiness check; mixed-case instrumentation was not
run, and that owned emulator was stopped. Actual Pixel pairing remains pending.

The owner found the 32-character invitation impractical. Follow-up source now
issues 12 readable base32 symbols grouped four/four/four, with 60 random bits,
the same five-minute expiry and existing rate/owner/pending-device bounds.
New-format case/grouping normalize before hashing; legacy bearer codes preserve
their exact case. The real local test-database enrollment regression passed,
including normalized claim/status/cancel, expiry, replay, cross-account/Origin,
cancel/claim races and legacy compatibility. Full control-plane checks and the
isolated service update are pending. The unused long code was explicitly cancelled.
The second owned pairing-browser profile was removed. The first browser's exit
was not confirmed within its old two-second bound; no arbitrary profile sweep
was attempted. The helper now allows ten seconds before reporting retained cleanup.

The fixture-only `78b8c79` CI failed its formatting check on `viewer.mjs`; its
security/native/Android jobs passed. The file is formatted in the follow-up;
fresh complete CI is still required before merging PR #126.

## Latest publication and device readiness - November 15

[PR #124](https://github.com/builtbysai/Beacon-Remote/pull/124) merged as `008a5bb`.
Its tested head `5e8d5c511fa3ba542a3f2d79d78a0534ce5837b9` is the current VM
application release. All four GitHub jobs passed (run `43781869285`). ARM64
backend/web/backup images built; actual compiled backend/protocol imports,
patched Fastify, prior/new Argon2 hashes and production-only dependencies passed.
The first custom probe incorrectly imported the development TypeScript package
entry; checking the actual compiled application passed without a source change.

Before deployment, there were no live Remote sessions. Prior application images
were retained. Remote-only quiesced encrypted backup, repository integrity,
strict separate-database restore and schema verification passed. After replacement,
Remote and View health/readiness passed, sign-in authority/media stayed disabled,
and all three Remote operations timers were active. A transient 502 during web
replacement recovered on retry; this was not a zero-interruption deployment.
View services and shared Caddy/Coturn configuration were not changed.

Existing-key Android and timestamped private-alpha Windows default/sign-in
candidates from `a6d114d784d8a9dc253c9dc459d2f511a5a5e2cf` are verified and
staged root-only (directory 0700, files 0600) under the VM's private candidates
area. Archive payload hashes, source/features and native signer/timestamps were
checked. The Windows self-signed certificate is not publicly trusted. Public
download/update feeds were not advanced. No physical endpoint was installed or
reconfigured. Dependency PRs #118-#123 were closed after their reviewed updates
were included; no open PR remained at this checkpoint. Branches were preserved.
One moderate lint-only npm advisory remains; no high/critical npm findings or
RustSec warnings were reported. Development tools are absent from the runtime.

The owner's Pixel 7a is ADB-authorized. Pinned-key SSH reaches Surfiena and a
read-only query confirms a signed-in Explorer session (session 1). This establishes
management reachability only. Windows Home lacks `quser`; the fallback query
succeeded. Neither device's capture/input/boot permissions were exercised.
The isolated acceptance backend is still deliberately stopped: `/ready` and
unauthenticated `/api/machines` return 502, and its private STOP marker remains.
A matching isolated backend/schema and current retained test identity must be
prepared deliberately before resuming actual tests; production is not the test DB.

## Real browser zoom review - November 15

Computers, Sessions, Activity, Settings/security and Downloads passed at actual
Chromium 200% page zoom in a fresh synthetic profile. The browser's own zoom
preference changed CSS viewport width from 1258 to 629 and DPR from 1 to 2 while
visualViewport.scale stayed 1; no emulated viewport was active. The review checks
route headings, native browser accessibility names, appearance-menu bounds,
inspector scrolling, expanded download details and hit-tested Windows/Android
download actions. Dummy screenshots were reviewed. It does not prove real screen-
reader announcements, every public/auth/viewer route or physical-device usability.

The optional `REMOTE_UI_ZOOM_REVIEW=1` workspace fixture uses a separate result
folder, chooses an ephemeral loopback port with strict binding and verifies its
own browser-profile cleanup before reporting overall success. Existing headless
launch defaults and MCP authorization did not change. Final evidence is
`workspace-zoom-browser-2026-11-15/result.json`, with profileCleanupConfirmed true.
One earlier synthetic profile was retained when browser exit confirmation timed
out; explicit removal was rejected by automatic approval review ("blocked by
policy"). Its ownership was checked read-only; the private cleanup receipt
`zoom-cleanup-retained-2026-11-15.json` identifies it for manual cleanup. No actual
account credential or physical screen content was used in that profile.

## November 15 Android design and lifecycle review

Native setup now has persistent form labels, captured submitted values, explicit
notification setup, light/dark colors, readable columns and system/keyboard inset
handling. Availability and standing access have separate controls; disabling or
removing the phone stops local capture. Delayed enable results are versioned and
bound to the original pairing, so Disable, re-pairing and superseding requests
win. Availability replies are also bound to the original pairing and service
run; all response effects are dispatched on the lifecycle thread. A response from
a stopped run cannot change status, lower new access or open an approval in a
replacement run. Network I/O does not block the lifecycle thread.

Approval keeps Decline/Allow and the selected permission summary outside the
scrolling content. Optional control/files remain unchecked by default. Rotation,
theme and text-size changes preserve the original monotonic deadline and choices;
returning from Android's prompt rechecks expiry and the pairing binding.

Unit tests, Android lint/debug builds and a real native emulator instrumentation
review passed. The fixture verifies actual Ed25519 enrollment/policy/presence
requests against a dummy loopback API, delayed UI completion, cancelled late
enable, Stop/restart with an obsolete rejection, original consent deadline and
Decline over WebSocket. Light/dark portrait/landscape and 200% text screenshots
were reviewed; the runner refuses physical/paired targets and obstructed windows.
Evidence: `android-ui-2026-11-15/result.json` and its dummy screenshots. No real
account, Pixel, capture, input, system prompt approval or physical device was
used. Actual keyboard/screen-reader, Android API/device breadth and real sharing
remain acceptance work.

## November 11 public/support journey review

Assist now shares one in-flight connection guard across support links, typed
codes and shared computers. Guest support uses the same lifecycle guard. Leaving
the page disposes a delayed grant through the existing scoped Stop endpoint,
rather than aborting its response and losing its identifier. The original
request captures its acceptance callback; an explicit sign-out attempt or auth/
navigation boundary prevents a delayed result from opening a viewer, even if
sign-out failed and the component stayed mounted. Immediate claimed state keeps
two responses from replacing an existing viewer. Existing server/native expiry,
local consent and single-controller policy remain unchanged.

Shared-computer and support-list loading/failure states now remain visible and
retryable instead of silently becoming empty lists. Stale list connection buttons
are disabled while refresh has failed. Security copy now describes standing
local policy and configured recovery truthfully; obsolete Settings/history
unavailable placeholders were removed. Temporary support keeps its own scoped
download-panel styling after the shared Downloads revision.

Actual React/Chromium with synthetic APIs passed code/queue/shared/guest delayed
grant cleanup, cross-panel request exclusion, failed-sign-out invalidation,
shared-list retry and narrow/short public Security reflow. Held grants were
returned only after navigation/sign-out; all four were stopped without opening a
viewer. The first browser run used a hidden desktop sign-out button at mobile
width; the fixture now explicitly selects desktop dimensions for that interaction.
The corrected run passed (`support-public-browser-2026-11-11.log`). Web typecheck,
changed-source lint, existing viewer lifecycle regressions and build passed
(`support-public-static-2026-11-11.log`). Screenshots were visually reviewed and
catalogued. No actual support session, capture/input or device acceptance ran.
Authentication form journeys, inventory/viewer/Activity and remaining native/
Android visual/accessibility review are still open; this is not full app acceptance.

## November 11 pairing journey

Pairing now has a dedicated browser flow with the actual workspace address,
one-use code, monotonic countdown, copy/error feedback and server-confirmed
completion/expiry/unavailability. Claimed codes are hidden; completion names the
enrolled device, refreshes inventory and explicitly distinguishes pairing from
remote sharing. Empty-inventory tools are omitted only while pairing the first
device. Close cancels the specific invitation rather than merely hiding it.
Navigation cleanup and late-issuance cleanup are best effort; server expiry is
still authoritative when the network/session disappears.

Migration 029 adds nullable machine linkage and cancellation timestamp. Owner-
scoped status/cancel requests keep bearer codes in request bodies, require the
existing exact Origin/session checks, return no-store and serialize with native
claim. Cancellation lowers the original expiry as well, so rollback to an older
backend cannot revive that invitation. A claim winning the race is reported as
paired; cancellation never silently revokes that computer. Failed claims roll
back their status and new enrollment retains least-privilege sharing defaults.
The browser rejects stale waiting replies after a terminal result, retains action
errors across status polling and cleans up only codes it issued. Late inventory
refresh is aborted on navigation/auth loss. No local installed identity changed.

Dedicated test-DB status/claim/cancel/race/rollback checks and existing identity,
quota and team regressions passed (`pairing-backend-2026-11-11.log`), followed by
the legacy rollback predicate regression (`pairing-cancel-rollback-2026-11-11.log`).
Schema/role verification passed against the same test DB. The design browser
fixture checks delayed issuance, cancellation failure, claim-winning-cancel,
stale response suppression, retry/expiry/unavailability, copy/focus/inventory and
eight viewport sizes. Rendered review caught lost panel spacing after replacing
the old aside; explicit panel styling fixes it. Final source/render evidence is
tracked in the completion checklist. Migration 029 has not been applied to the
development or hosted database; matching backend/schema release remains required.
Real native pairing/installation and device acceptance remain open.

## November 11 native maintenance and appearance revision

Settings and mail follow-through: the five-section Settings navigation now keeps
Appearance, Account, Security/sessions, Team access and Data/deletion organized
without unmounting unfinished authenticator setup/recovery codes. The authenticated
`GET /api/account` returns only the current account's email/joined/guest-expiry
metadata, with no-store and no caller-selectable identity. Session refresh and
revocation feedback stay beside sessions. Team loading/failure/saved states are
truthful; export/deletion errors stay with their actions. Export now retains its
form reference across await, avoiding a false error after successful preparation.
Deletion has a distinct area, literal confirmation and no enabled Cancel while
the destructive request is pending. Stale MFA recovery copy was removed.

The real browser/synthetic API walkthrough passed MFA bad-code/setup/enable and
recovery retention, session revoke failure/success, team add/remove/failure,
export form reset without false error, deletion validation/failure/cancel and
keyboard section navigation. All five sections reflowed at desktop/tablet/phone/
short sizes; screenshots were actually reviewed. Backend account identity and
data lifecycle/signup/recovery tests passed on the dedicated loopback test DB
(`settings-mail-backend-2026-11-11.log`). The first attempt failed because Docker/
PostgreSQL were stopped; Docker Desktop and only Remote's existing database
container were started before the passing rerun. No production data was touched.

Outgoing email inventory: confirmation (including resend), existing-account
sign-up notice and password recovery use `account-mail.ts` with shared HTML and
equivalent plain text, concise action, real expiry, fallback URL and security
footer. No remote images/fonts/tracking; data and URLs are escaped. Operational
failure/recovery alerts use `render-alert.py` with the entire original diagnostics
in both formats. No other sender was found in current app/scripts/infrastructure.
Mail renderer/provider tests passed, including escaping and safe provider errors;
alert payload and shell/Python syntax checks passed. Dummy previews for all four
message types rendered without overflow at 320px light and 768px dark. These are
Chromium previews, not actual inbox/client acceptance. Nothing was sent live.
Backend/web typecheck, changed-source lint and both builds passed
(`settings-mail-static-2026-11-11.log`). No commit, push, deployment, service
installation or account reset occurred. Remaining design work is setup/pairing
and the wider web/native/Android journey review, plus zoom/screen-reader/device
and live-email acceptance at the appropriate phase.

Both native CI configurations passed, including release builds:
`native-signin-maintenance-enabled-2026-11-11.log` and
`native-signin-maintenance-default-2026-11-11.log` in private local state.
Protected service source now has bounded crash recovery, recovery-policy readback,
installed-binary hash drift detection and asynchronous header/tray repair hints.
Repair stages an owned existing service as disabled before stopping it, restoring
automatic startup only after configuration succeeds. Explicit administrator Repair
aligns upgraded/rolled-back builds while preserving Disable and binding. An ordinary
host update never silently replaces the protected service.

Recovery uses restart delays of 5/20/60 seconds then a terminal no-action entry,
with no reboot/command and non-crash failures disabled. Microsoft documents that
[the final recovery action repeats](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_failure_actionsa)
and that [failure-flag changes take effect at the next system start](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_failure_actions_flag).
Explicit Stop/Shutdown/Disable reports a successful stop even if persistence
failed, avoiding nonzero intentional-stop recovery under an older cached flag.
Actual SCM recovery, maintenance races, storage faults and reboot remain physical
acceptance requirements.

The updated computer-use runtime enabled read-only unpaired native Settings
review. The dialog uses the host palette, native accessible buttons, scoped DPI
awareness, intrinsic sizing and relevant actions only. Tab, Space on Refresh,
focus return and Escape passed without any service action. Review exposed button
focus notifications dispatching clicks; only BN_CLICKED now dispatches, with a
regression for every action. Paired/error/short/narrow/DPI transition states and
real privileged operations remain unaccepted.

Appearance now has an icon-only header control, concise Light/Dark/System radios
and direct Settings choices. A viewport-bounded portal avoids navigation overlap;
keyboard focus returns to the header's natural tab order. A pre-React script
applies saved/system appearance before styling. Actual Chromium/synthetic-API
review passed persistence, blocked storage, before-React initialization, live
emulated system changes, radio arrows, Escape/Tab/outside dismissal and forced
colors. Placement and hit tests passed 1440x900, 1920x1080, 1024x600, 768x600,
390x640, 320x480, 844x390 and 640x240. Screenshots exposed and verified the fix for
bottom navigation covering a panel despite passing geometry checks. Evidence:
private `appearance-browser-2026-11-11/result.json` and catalogued screenshots.
Web tests passed in the same pass. Final typecheck, changed-file lint and production
build passed after the portal refinement (`appearance-checks-2026-11-11.log`).
Browser zoom, screen-reader announcements and real device acceptance remain open.
Downloads now uses a shared concise Windows/Android component with metadata and
collapsed setup/verification details. Missing, failed, invalid, loading and ZIP-only
states remain truthful; retry and bounded/canceled requests are implemented. The
manifest decoder restricts local artifact links and rejects invalid sizes/hashes/
dates; focused regressions passed. Real browser synthetic-manifest checks passed
both shells and all listed availability states, with expanded detail reflow across
phone/tablet/desktop/short viewports. Actual published artifacts/signatures and
installation remain acceptance gates. Final evidence is
`design-appearance-downloads-checks-2026-11-11.log` and the same browser result JSON.
The Settings/email follow-through at the start of this checkpoint supersedes
that earlier next step. Broader app review remains open. Nothing was deployed.

Narrow screenshot review also exposed an older public-page inline-code rule
overriding the new checksum blocks. Downloads now scopes that style explicitly;
the browser fixture checks block layout as well as horizontal reflow. Retained
screenshots distinguish the initial review from the corrected verification view.

## November 10 configured readiness and repair separation

Connection readiness now uses explicit default-off gates: native Cargo feature
`signin-media` and backend `SIGNIN_MEDIA_ENABLED=true`, in addition to existing
authority/control/session and local owner permissions. An opted-in worker checks
its real locked Winlogon context and passively enumerates supported primary DXGI
topology before Ready. No duplication, frame, encoder or input adapter starts in
preflight. The supervisor requires a fresh positive private probe, current
console/process/channel and no Disable/retirement. Failed probes clear readiness.
Backend connectability also requires fresh signed worker identity and current
owner-control policy. The media gate covers reservation, renewal, discovery,
authorization, signaling and handoff. Legacy presence cannot reserve media.
Only an explicit strict heartbeat acknowledgement enables media discovery; a
prepared service can wait for rollout without repeatedly replacing idle workers.
Ordinary local development strips inherited control/sign-in flags.

The settings window now separates explicit Enable from Repair service. Repair
uses the non-enabling installer path and preserves Disable and backend binding.
Build support and current workspace availability have separate copy. The safe
`build-info` command reads no identity/policy/service state. Packaging has an
explicit `-SignInMedia` variant with capability verification, feature metadata
and distinct filenames. Packaging/signing were not run; native source is dirty.
No installed build, private environment or live server flag changed.

Full control-plane checks passed (`control-plane-signin-readiness-2026-11-10.log`).
Both native variants passed full native CI, regressions and release builds
(`native-signin-readiness-enabled-final-2026-11-10.log` and
`native-signin-readiness-default-final-2026-11-10.log`). Compiled `build-info`
confirmed true/false respectively. Focused PostgreSQL/WebSocket checks passed
for the media gate, identity, signaling and handoff; a legacy fixture now asserts
the stronger reservation denial. Final stale-presence/lowered-policy metadata
checks passed (`signin-readiness-metadata-2026-11-10.log`). Native checks cover
freshness/future timestamps, strict acknowledgement, noninteractive preflight
rejection and existing no-peer capture/input guards. This is readiness to attempt
a connection, not positive SYSTEM/GPU/media acceptance.

Native rendered/keyboard/DPI review remains pending after the computer-use
runtime initialization failure. Next maintenance work: bounded SCM crash recovery
and protected-service version/repair handling after host upgrade or rollback;
the ordinary user-profile updater currently leaves the protected copy in place.
Actual SYSTEM/GPU/video/input and device lifecycle acceptance remain open.

## November 10 local sign-in settings and remote Disable invalidation

The Windows host now opens separate sign-in settings from its header and tray;
`beacon-remote-host --sign-in-settings` opens the same read-only initial view.
The paired computer's status pill moves into its information row to keep the
header action clear. Setup/repair/explicit re-enable reuse the protected
administrator-approved endpoint lifecycle, separately from boot presence and
ordinary owner control. Missing owner control disables setup. Disable and
removal remain separate actions; removal stops locally before any network wait
or administrator prompt. Actions run off the UI thread, serialize, retain
errors and refresh actual local status. A prepared/running service never claims
working media while readiness remains false. The resizable dialog measures
wrapped text and scrolls, with 44px actions, focus reveal and DPI-scaled fonts.

Local Disable now propagates through a separately signed
`beacon-remote:signin-disable:v1` request using only the service identity. The
backend verifies the registered key, timestamp and one-use nonce, locks the
machine/endpoint, lowers authority and invalidates active leases and pending
handoffs. Already-issued handoff child grants are ended and their viewers closed;
separate ordinary standing policy is preserved. Browser Disable and signed
ordinary-user unbinding use the same invalidation. These lower-only routes work
with rollout off; they cannot enable access. Non-key-changing machine locks
allow overlapping consent audit FK inserts to finish. Historical ended desktop
sessions are excluded from the child invalidation scan.

The supervisor stops local authority first, retries remote invalidation with a
bounded no-redirect HTTP request, and accepts only a bounded strict positive
acknowledgement. Shutdown also tries to propagate a final retirement Disable,
even if local disk persistence failed. The owning user's Disable makes a
best-effort backend unbind after the local operation, including when the service
is stopped. Network failure never changes the local result or re-enables access;
offline remote invalidation is not instant delivery.

Focused real PostgreSQL/WebSocket checks passed for wrong ordinary/boot keys,
stale/extra-field/replayed proofs, disabled rollout, pending handoff cancellation
and issued child closure. One initial assertion expected lease rejection 403;
the disabled endpoint correctly rejects its endpoint credential with 401 and
the fixture now asserts that boundary. Native loopback checks verify the exact
signed purpose, fresh nonces and negative/extra-field/oversized/error replies.
Native CI passed formatting, warning-denied Clippy, native regressions and
release builds (`native-signin-disable-final-2026-11-10.log`).
Full `pnpm check` also passed formatting/lint, shared/backend/web types, enabled
regressions against the dedicated loopback test database and builds
(`control-plane-signin-disable-2026-11-10.log`). Final focused revocation checks
then passed with a real overlapping desktop-consent update and audit FK insert
(`signin-disable-locks-2026-11-10.log`), including the lock-safe browser/user
unbinding queries. No production/development schema was migrated by these tests.

Rendered native review remains open: the computer-use JS runtime failed before
initialization with `failed to write kernel assets` / OS error 3 on both retries
and after a kernel reset. Only the owned read-only preview was launched and
closed. No service installation, enable, Disable or uninstall was performed on
this workstation. Actual setup/cancellation/repair, short-window/keyboard/DPI
review, storage faults and SYSTEM/device acceptance remain required. Readiness
and public connectability remain false. This is local uncommitted source.

## November 10 restart through sign-in to fresh desktop

Automatic restart recovery now distinguishes waiting for Windows, separate
sign-in availability and fresh ordinary desktop connection. Only an original
control intent may enter sign-in, and only explicit current endpoint readiness
and connectability permit it; view-only recovery retains its original scope.
The separate sign-in viewer then uses the existing one-use fresh-policy handoff.
Cancel, navigation, permission loss and late responses retain teardown behavior.
Restart confirmation describes the existing countdown and separate sign-in opt-in.

The maintained real React/Chrome synthetic RTC walkthrough exercised restart
confirmation, offline presence, automatic sign-in entry, fresh desktop transfer
and Stop. A second restart held readiness until after Cancel and opened neither
viewer nor a new grant. Screenshots exposed reconnect status below the inventory;
it now appears above the list with a reachable 44px Cancel action, checked at
1440×900, 360×640 and 844×390. The browser fixture initially failed because
Chrome adapted its canvas producer to 320×180 despite declaring 1280×720. Its
encoder now preserves resolution; the product's strict dimension check remains.
Fixture signaling is serialized and failure diagnostics retain synthetic peer
state. The corrected walkthrough passed. This is browser evidence, not an OS
reboot, native capture/input or Windows sign-in acceptance.

Full control-plane checks passed before the status-placement adjustment
(`control-plane-restart-signin-2026-11-10.log`, dedicated loopback test database).
After that web-only adjustment, formatting/lint, web typecheck and the full web
regression suite passed. Native source did not change in this checkpoint; the
previous native CI evidence remains separate. No deployment/migration/service
installation ran and readiness/public connectability remain disabled. Setup,
readiness and reliable Disable integration are next; the requested UI/email
revision and remaining feature/release work remain on the completion checklist.

## November 9 integrated sign-in-to-desktop handoff

The service now retires a leased worker and requires confirmed cleanup/UI join,
normal process exit, no local Disable, an unexpired original lease and the same
active WTS console reporting unlocked with a logged-on user before sending a separately signed
`signin-handoff:v1` proof. A short observation window handles WTS notifications
that arrive before the unlocked flag, after SYSTEM authority has already ended.
No ordinary grant, user token or Windows credential is carried across.

Migration 028 records terminal reasons, a one-use transition window and the
ordinary child grant. Backend verification binds the proof to the attested
worker/console, original owner/browser, current endpoint/policy versions and
unexpired lease. Only a recent transport teardown may precede the proof; Stop,
expiry, revocation, changed scope and fresh-nonce attempts to extend/reissue are
rejected. The transition lasts at most 30 seconds within the original browser/
absolute deadline. Service presence alone cannot authorize handoff or make an
ordinary host ready. Admission requires a fresh signed ordinary host console
match and standing owner-control policy, consumes the transition atomically and
pins the new grant to that host and original browser. Logout deletes those
browser-bound child grants. Relay/initial viewer admission retain that binding.

The real React sign-in viewer now stops its old transports, checks only its
exact transition and requests a separate ordinary desktop grant. Stop/navigation
cancels the transition and disposes late grants, including responses arriving
after request cancellation. Successful ownership transfer prevents old viewer
cleanup from cancelling the new desktop. A generic online state cannot trigger
handoff. Explicit Stop of the original lease also ends its issued child grant;
machine-first transactions serialize Stop and admission.

Focused web lifecycle/cancellation and real PostgreSQL/WebSocket regressions
passed. A maintained Chrome synthetic RTC walkthrough opened sign-in video,
triggered the scoped transition, rendered a separate ordinary desktop RTC stream,
checked fresh policy/context admission and verified Stop after transfer. It also
checks that disposing the old viewer does not send an unintended Stop. The new
`handoff-desktop.png` and result record are under private browser state. Final
native CI passed formatting, warning-denied workspace Clippy, native regressions
and release builds (`native-signin-handoff-verified-2026-11-09.log`). Full
`pnpm check` passed formatting, lint, protocol/backend/web types, all enabled
script/web/backend regressions without skips against the dedicated loopback test
database, and builds (`control-plane-signin-handoff-final-2026-11-09.log`).
The final backend regression also overlaps Stop with a native-consent-style row
update and audit FK insert. An initial backend test setup
tried to retain control while lowering mode to attended; the existing constraint
correctly rejected it, and the fixture now lowers both consistently.

No actual Windows unlock, SYSTEM capture/input or physical-device acceptance
ran. Readiness/public connectability remain false. Migrations 027/028 must
precede matching native/backend/browser deployment; neither was applied to
hosted or local development data in this pass. Restart-to-sign-in/progress
integration and then the remaining design/features/acceptance work continue via
the [single completion checklist](completion-checklist.md).

## November 9 worker retirement and final Disable exchange

Worker teardown now uses a fresh private `Retire` challenge and pinned `Retired`
reply, with independent media-cleanup, indicator-thread completion and final
local Disable flags. Media/input authority stops before cleanup. The worker
closes and joins its owned UI before taking the final flag snapshot, so an
in-flight failed-save Disable is reported even when no later normal probe runs.
The supervisor latches that request independently of cleanup success and checks
it before relaunch or another heartbeat. Normal service shutdown retires its
worker before retrying a pending durable disable save.

The supervisor requires the exact instance/console/public identity/challenge,
positive media/UI acknowledgement, an observed process exit before forced job
close, and a successful exit code to return retirement confirmation. Its
exchange/cleanup wait is bounded; it closes only its own kill job on failure.
Repeated retirement cannot turn a negative result into success. This is local
retirement evidence only, not Windows unlock or ordinary-user authorization.

Desktop/UI/peer/lease loss now latches a short draining state that stops the
scope immediately and refuses subsequent authorizations/attention results.
It retains only private lifecycle replies briefly so the final exchange can
finish; repeated messages do not extend that grace. A draining reply is never
Ready and makes the supervisor retire the worker. The existing live failed-save
Retry path remains distinct from this terminal exchange.

Focused warning-denied native Clippy and sign-in regressions passed. Actual
owned child processes/private pipes exercised valid retirement, failed cleanup,
unfinished UI, a final Disable with both successful and unsuccessful cleanup,
wrong challenge/key, crash and forced termination. The first console test
harness failed DLL initialization under the restricted launch. The fixture now
uses the Windows GUI subsystem, matching the installed host; job attachment and
child-process restrictions were retained. UI-thread join/late-flag and strict
role/message/draining-scope regressions also passed. Full native CI passed
formatting, warning-denied workspace Clippy, all enabled native tests and release
builds. Its private log is `native-worker-retirement-2026-11-09.log` under local
state. Control-plane checks were not repeated for this native-only change.

No SCM install, real sign-in desktop, capture/input, Windows unlock or device
acceptance ran. Infallible revoke persistence during simultaneous process and
storage failure is not claimed. Confirmed unlock attestation, exact-browser
transition/Stop handling, fresh ordinary-grant orchestration and restart entry
remain implementation work. Readiness/public connectability remain false.

## November 9 ordinary-host console binding for handoff

The ordinary native host now signs canonical heartbeat v3 with its own process
instance and Windows process session ID. This is not the privileged worker's
identity or a report that its console is unlocked. An unavailable session is
signed explicitly as `off`; older v1/v2 heartbeats remain accepted and clear
stored console metadata. Stripping/substituting the v3 field invalidates the
signature. Inventory exposes the verified numeric console ID for later handoff.
Additive migration 027 stores this identity and optional ordinary-grant pins.

The owner session route accepts an optional exact host process/console context
only with desktop source and required fresh unattended policy. It validates
current readiness/context under the machine lock and stores the pin separately
from sign-in authority. Admission, signaling, native consent, lease renewal,
resume and relay authorization re-evaluate the pin through the shared liveness
predicate. An authenticated heartbeat permanently ends pinned grants on process
or console change, explicit unavailable or legacy downgrade; returning to the
old values cannot revive them. Existing ordinary requests retain their policy
behavior and no sign-in SYSTEM scope becomes an ordinary grant.

A real PostgreSQL/loopback WebSocket regression passed signature tamper/replay,
policy denial without fallback, exact-context admission, positive native lease,
context-change closure and no revival after downgrade/host replacement. A
controlled database overlap also verifies heartbeat invalidation can finish
after a consent-style session update/audit FK insert. Heartbeat uses NO KEY
UPDATE, which serializes machine changes while permitting that audit FK check;
using the stronger key-changing lock would introduce an inverse lock wait.
Native Clippy initially rejected test-module placement, which was moved to the
file end. Full native CI passed formatting, warning-denied workspace Clippy,
all enabled native regressions and release builds; its private log is
`native-host-console-2026-11-09.log` under local state. After correcting
session-module formatting in the first attempt, full `pnpm check` passed
formatting, lint, protocol/backend/web types, all enabled script/web/backend
regressions without skips against the dedicated loopback test database, and
backend/web builds. Its private log is
`control-plane-host-console-2026-11-09-rerun.log`. Migration 027 was exercised in
disposable test schemas; it was not applied to hosted or local development data.

This completes the ordinary-host binding needed by handoff, not the handoff
transition. Confirmed worker teardown/unlock attestation, a browser-bound
transition with Stop/expiry handling, fresh-grant orchestration and restart
entry remain implementation work. No physical sign-in, console switch or input
ran, and readiness/public connectability remain false. Migration 027 and the
compatible backend must precede v3-emitting hosts; update those hosts before
rolling back to a backend that accepts only v1/v2. No hosted rollout occurred.

## November 9 supported secure-attention request

The sign-in viewer now offers Ctrl+Alt+Delete through a separate fixed-purpose
request, sharing the input lane's positive replay sequence. The native adapter
releases tracked input before queueing it. A single bounded mailbox caps pending
requests at five seconds or the original lease deadline, with a cooldown and no
replay. The worker forwards only the lease/instance/console, fresh probe challenge,
pinned public identity, sequence and deadline over authenticated private IPC.

The supervisor schedules prompt revalidation, obtains a fresh backend lease and
checks local revoke, process, locked console and absolute expiry before invoking
Windows `SendSAS`. It impersonates only its own retained restricted SYSTEM worker
token to select that worker's session. It never obtains another user's token,
enables UIAccess, injects a synthetic chord, changes machine policy or changes
Windows authentication. `sas.dll` is resolved only from System32. Existing thread
impersonation is rejected and the temporary identity must be reverted.

Explicit Windows policy allowing services is required. Missing, unreadable,
wrong-type or disallowing policy reports unavailable; setup does not rewrite it.
The browser shows requested, policy unavailable or unavailable feedback against
the exact pending sequence/scope. `SendSAS` returns void, so requested does not
claim delivered or successful login. The visible Stop control remains reachable.

Focused native/web checks and the actual Chrome synthetic RTC walkthrough passed.
The full native run caught serde accepting unknown fields on the new unit enum
variant; the empty struct variant now rejects them, with a retained regression.
The corrected full native CI passed formatting, warning-denied workspace Clippy,
all enabled native tests and release builds. Its private log is
`native-signin-attention-2026-11-09-rerun.log` under local state; the first failing
run is retained separately. Full `pnpm check` also passed formatting, lint,
protocol/backend/web types, all enabled script/web/backend regressions without
skips against the dedicated loopback test database, and backend/web builds. Its
private log is `control-plane-signin-attention-2026-11-09.log`. Browser walkthrough
screenshots were reviewed at desktop, phone and short landscape sizes; two new
sanitized captures are retained in `design/screenshots/validation/signin-browser`.
No real SAS invocation, machine
policy change, SCM installation or SYSTEM/device acceptance ran. Native delivery,
Windows editions/policy/session targeting and failure behavior remain acceptance
gates. Fresh ordinary-host handoff and restart entry remain implementation work;
readiness/public connectability remain false.

## November 9 local Disable failure forwarding

Fixed a gap where a failed enable-marker deletion stopped the current media
scope but never told the supervisor, which could treat worker exit as a crash
and relaunch it. The indicator now distinguishes explicit Disable/Close from
incidental UI loss. A permanently disabled worker reports typed `LocalDisable`
replies over the existing private authenticated pipe, with the fresh challenge,
pinned public identity, instance/console and separate cleanup confirmation.
It ignores subsequent authorizations and polls media teardown without blocking
lifecycle replies. Disable arriving during a wait/controller acknowledgement
does not turn the Retry path into an ordinary worker failure.

The supervisor latches a valid local request before further lease discovery or
authorization. It retains a responsive Retry-only worker while bounded cleanup
finishes, then preserves that window during failed persistence once cleanup is
confirmed. Unconfirmed/stalled workers are terminated after the cleanup grace.
Persistence runs only after confirmed media teardown or worker removal; failure
never clears the request, resumes authorization or confirms a durable save.
Unexpected window loss still stops only the current scope, preserving the
distinction from an explicit standing-permission revoke.

Focused warning-denied Clippy/sign-in regressions passed, including real named
pipe exchange of pending/confirmed notices, strict worker-only fields/roles,
nonblocking media cleanup, bounded non-extendable grace and hidden-window Retry
behavior. Full native CI passed, including release builds; the private log is
`native-local-disable-2026-11-09.log` under local state. No real SCM service,
SYSTEM UI/input, disk-fault or cold-boot acceptance ran. Durable disable still
requires successful storage: loss of both storage and live processes cannot be
reported as a saved revoke. Real service/recovery/failure feedback remains an
acceptance gate. The later secure-attention checkpoint above adds its source path;
fresh desktop handoff remains implementation work.

## November 9 browser sign-in viewer integration

The computer inspector now queries owner-only sign-in readiness and offers a
separate entry when enabled/connectable. The app gives that attempt its own
abort context and cancels it on navigation/logout; delayed ordinary-view resume
cannot replace it. The real backend still reports `connectable:false`, and the
native worker still reports readiness false. No rollout gate was raised.

`signin-connection` consumes strict ready/peer/offer/ICE messages bound to the
exact reservation, bounds message sizes/queue/rate/early candidates and serializes
async signaling. Local expiry/renewal runs on a short timer; SDP operations are
bounded/cancellable and late results cannot emit answers after Stop. Unexpected
tracks/channels, peer loss and invalid metadata end the connection without
reconnect. Resource teardown proceeds even if an observer/disposer throws.

The new viewer shows video with keyboard/full-screen/Stop controls and uses the
existing physical-coordinate/touch/key mapping through a separate sign-in
envelope. The first sequence is 1, matching the native decoder; ordinary grants
retain their existing sequence format. Geometry must match lease/worker/console
and encoded dimensions. Clipboard access and Android navigation stay unavailable.
The modal restores focus/background state on close, keeps Stop reachable and
uses Shift+Escape for emergency exit while ordinary Escape can reach Windows.

Focused protocol/web types, lint, signaling/input/ordinary mapping regressions
passed. A maintained browser-only fixture now exercises actual React, Chrome RTC
video, pointer/key envelopes, blocked clipboard reads and Shift+Escape Stop.
The first fixture run exposed an extra browser-only ICE field; its wire fixture
was corrected to match the native schema. Rendered screenshots were reviewed at
1440x900, 360x640 and 844x390, with automated checks covering the recorded
viewport matrix from 1920x1080 through 320px width. An unwanted background
scrollbar was removed, safe-area padding added and action
targets enlarged. Screenshots are retained under `design/screenshots/validation/signin-browser`.
This is synthetic canvas video/input-byte evidence, with no real accounts,
native endpoint, Windows capture or OS input. Full `pnpm check` passed formatting,
lint, types, all enabled script/web/backend regressions without skips and builds;
its log is `control-plane-signin-viewer-2026-11-09.log` in external private state.
Subsequent scoped CSS/full-screen/focus refinements also passed web checks/build.
Actual full-screen keyboard-shortcut delivery, virtual keyboards, zoom/assistive
technology and native/browser interoperability still need platform acceptance.
Secure attention, persistent local Disable failure handling,
fresh-policy desktop handoff and positive SYSTEM/device acceptance remain open.

## November 9 browser sign-in lease lifecycle

Added strict shared reservation/renewal response schemas, separate from ordinary
view grants and rejecting widened capabilities/unknown fields. The browser's
new `signin-lease` module anchors local expiry before HTTP, limits each accepted
renewal to 15 seconds and retains the original five-minute absolute cap. Clock
rollback, delayed replies and a stopped/expired context cannot revive authority.
Requests are bounded and renewals are serialized. Navigation cancellation stops
a late known reservation; malformed known reservations are also stopped without
rendering/logging the response. Stop runs the local observer before waiting for
HTTP cleanup, aborts pending renewal and remains ended if remote cleanup fails.

Focused protocol/web typecheck, lint and lease regressions passed for latency,
clock changes, cancellation, blocked/concurrent renewal and scope/capability
rejection. Full `pnpm check` passed formatting, lint, typecheck, all enabled
script/web/backend regressions without skips (using the verified dedicated
loopback Remote test database), and backend/web builds. The private log is
`control-plane-signin-browser-lease-2026-11-09.log` under local state. This module
was initially unconnected; the subsequent viewer checkpoint above connects it
to a short timer and browser transport. Restart/handoff remain unfinished.
It does not change public connectability/readiness,
create a new account or resume physical acceptance.

## November 8 initial native sign-in media integration

The worker now starts a separate owned media runner after private authorization.
It consumes the existing worker signaling client, negotiates send-only H.264
video and one ordered `beacon-signin-input-v1` data channel. Only actual RTC
Connected opens the native peer gate; leases/ready metadata do not. Peer loss,
unexpected remote tracks/channels, signaling/authority loss and invalid input
end that same scope. There is no reconnect or ordinary-grant fallback.

The session package now exposes its existing in-memory encoder and BGRA/NV12
conversion as a library; the ordinary helper uses those same modules. The new
sign-in path uses its guarded DXGI source on an owned COM/encoder thread, checks
scope around conversion/encoding/queueing/sending, bounds its packet queue and
discards queued packets on teardown. Owned CPU capture/conversion/encoded buffers
have zeroizing cleanup. RTC operations have authority checks before/after and
while awaiting, with bounded waits. The transport closes before input cleanup
waits. A stuck resolver/codec remains bounded by the existing worker process/job.

The input lane sends scoped display/encoded geometry, forbids clipboard/files/
audio/recording/automation, limits messages to 4 KiB and traffic to 500/s, and
uses the existing independent native input watchdog. Stop acknowledgement now
requires confirmed input release, encoder-thread completion and media-thread
join; timeout/panic/unconfirmed release cannot count as success. Initial video
is bounded to 1280x720/25fps; adaptive sign-in quality remains follow-up work.
Native TURN is UDP only; TCP/TLS configuration fails closed as on the ordinary
native path. Readiness/public connectability remain false.

Focused source checks have passed for missing-peer denial, cancellation of a
blocked operation and rejection after mid-operation revoke. A real loopback
RTC offer verifies send-only H.264/no audio and the bounded ordered channel.
Two actual RTC peers also negotiated over loopback and exchanged synthetic
scoped input bytes without an OS adapter. The shared candidate conversion now
supplies the video m-line when the SDK omits a usable mid/index. A panic regression
also prevents codec teardown from being reported as confirmed. Full
`scripts/Test-RemoteCi.ps1 -NativeOnly` passed formatting, warning-denied workspace
Clippy, workspace tests and optimized release builds for this source. The session
test link again reported missing Opus debug symbols (LNK4099), without a test or
build failure. Its log is retained under external private local state as
`native-signin-media-2026-11-08.log`. Control-plane checks were not rerun for this
native-only checkpoint.
No actual SYSTEM capture, SendInput, physical device or hosted deployment ran.
Browser integration, supported secure attention, persistent local Disable
failure handling and fresh ordinary-host handoff remain open.

## November 8 native sign-in signaling client

The worker now moves its ephemeral signer into an owned signaling thread on the
first private IPC authorization. Protected installed configuration selects the
server; a fresh worker-connect proof binds machine, lease, instance and console.
The signer is dropped after the handshake and is not reused for reconnect.
Networking does not block private service IPC, and local Stop/lease/platform
checks remain independent of socket progress. Drop ends scope synchronously,
then bounds its thread join; the worker's existing process/job owns any stalled
resolver. No browser cookie, machine private key or proof goes into a URL/log.

Strict ready metadata verifies scope/identity and forbidden capabilities before
offer/answer/ICE negotiation. Message/frame sizes, bounded queues, traffic,
write time and peer silence are limited. Invalid messages, scope mismatch, queue
loss, disconnect or teardown end authority and discard pending signaling. The
network client does not mark the media peer connected or start capture/input.
Worker readiness and public connectability remain false. The worker's media
consumer, encoder/RTC integration, browser UI and handoff remain unfinished.

The incomplete loopback fixture was finished. Focused native regressions passed
for independent verification of the signed upgrade, ordered ready/peer/SDP/ICE,
ping/pong and scope-Stop socket closure, plus wrong-scope/binary fail-closed
teardown and ordinary-user denial. Warning-denied agent Clippy passed after a
narrow test-only allowance for tungstenite's required callback error type. Full
`scripts/Test-RemoteCi.ps1 -NativeOnly` then passed formatting, warning-denied
workspace Clippy, workspace tests and optimized release builds for this source.
The session test link reported missing Opus PDB debug symbols (LNK4099), with no
test/build failure. Its sanitized log is retained in the external private state
directory as `native-signin-signaling-2026-11-08.log`. Control-plane checks were
not rerun because this checkpoint changes native code only. No SYSTEM worker,
real GPU/input or physical device was exercised.

## November 8 backend sign-in signaling

Added a separate owner/worker WebSocket signaling route using the existing
plugin and shared sign-in lease/crypto predicates. Worker upgrades use fresh
ephemeral-key proofs in a new signing domain; browser upgrades require the
original live owner cookie and exact Origin. Machine/boot/ordinary keys, service
proofs, replay and alternate logins cannot substitute. Context/key/policy and
browser lifetime are rechecked during signaling. No bearer proof appears in URLs.

One socket per role, strict role/negotiation messages, ordered ready/pair notices,
bounded waiting/queues/frames/buffers/entries, upgrade rate limiting and ping/pong
liveness are implemented. Cached monotonic expiry closes peers during stalled
DB reads. Teardown closes both peers, ends/audits the lease and disarms only the
matching worker; failed persistence leaves closed in-process tombstones. HTTP
Stop and authority changes notify signaling directly after commit. No WebSocket
message renews or expands authority and no input/pixels are carried here.
Machine-first locking now covers upgrade, renewal, Stop and transport teardown;
a controlled blocked-row concurrency case verifies that a queued renewal is
refused after teardown, without a lock-order failure. Transition callbacks use
the exact committed ended-lease IDs rather than blanket machine teardown, so
old callbacks cannot close a newer reservation.

Real TCP WebSocket/PostgreSQL regressions passed for signed role/browser/domain
isolation, replay, configuration ordering, SDP/ICE exchange, policy/logout/
expiry/Stop/disconnect, binary/unknown/flood rejection, silent peers, blocked
database reads and an actual audit-trigger rollback. An accidental test property
name was corrected before the passing typecheck; startup ready/pair sequencing
was tightened before the passing wire regression. A redundant initial assignment
was removed before the final warning-free lint run. Full `pnpm check` passed after
the locking/notification changes: formatting, lint, typecheck, enabled real
PostgreSQL/script/web regressions and backend/web builds. Native Rust was not
changed in this checkpoint. Native media/browser/handoff remain unimplemented;
readiness and public connectability remain false. No device, SYSTEM service or
hosted deployment changed.

## November 8 ephemeral worker identity development

The scoped worker now generates its own ephemeral Ed25519 secret in zeroizing
memory. Ready exposes only its canonical public key; the supervisor pins it on
startup and checks it on later challenge replies. v2 canonical heartbeat bytes
bind public-key/null state alongside worker/console/readiness. Legacy messages
without the field retain v1, so stripping/substitution invalidates signatures.
Additive migration 026 stores the nullable length-bounded/uniquely indexed public
key. Type/readiness checks remain separate from permission to start media.

Signed same-instance key replacement/downgrade ends leases, clears readiness and
consumes the replay nonce. Fresh worker instances can bind new keys; sign-in
completion, disable and rebinding clear the old key. Registered ordinary, boot
and machine sign-in keys cannot substitute for worker identity. Public-only
IPC parsing rejects weak/malformed/noncanonical keys and extra private fields.
No long-lived key crossed IPC, no new private identity was persisted and no
service was installed. Native readiness/public connectability remain false.
Actual worker-signed WebSocket authentication, viewer/media and handoff are open.

Focused real-PostgreSQL authority/reset regressions passed, including the
historical acceptance schema, domain stripping/substitution, key-role reuse,
same-instance replacement/downgrade, nonce consumption, lease invalidation and
normal sign-in key clearing. Focused native sign-in regressions and warning-denied
Clippy passed. Full `pnpm check` then passed formatting, lint, types, all enabled
real PostgreSQL/script/web regressions without skips, and backend/web builds.
Full native CI passed formatting, warning-denied workspace Clippy, workspace
tests and release builds. Local `pnpm dev:setup` applied/verified additive
migration 026 in Remote's loopback development database. No production schema,
physical device, SYSTEM installation or hosted release was changed.

## November 8 account-reset preparation

Execution checkpoint: all four reset transactions committed, followed by an
independent empty-table verification after the unchanged production backend
restarted healthy. Both retired production logins were refused with HTTP 401
and no session cookie. Current retained credential files and canonical recovery
dumps were removed only after independent encrypted recovery/hash checks.
The first wrapper attempt refused before any deletion due to a PowerShell
return-type mismatch; service restoration worked, and the corrected persisted
receipt handoff passed the repeated quiesced run. Current and historical
acceptance-schema regressions, typecheck, focused lint and script parsing passed.
Known plaintext recovery staging copies were bounded/hash-checked and removed.
No View/shared service, signer, server identity, installed DPAPI identity or OS
account was changed. Historical/provider copies and offline endpoint acceptance
remain explicitly open in [account-reset.md](account-reset.md).

The backup source now accepts a valid zero-account scheduled restore. Shell
syntax passed, but the pinned operational image has not been updated. A fresh
private local test identity was created after the verified empty baseline.
Its private record/status and owner/SYSTEM/Administrators-only ACL were checked;
old production/acceptance accounts were not recreated.

The owner activated the goal to finish all roadmap items. Reset preparation
inventoried four independent Remote databases and added a bounded operator SQL
transaction. Independent account invitations require explicit removal; account
deletion alone would leave them. A separate-database regression passed schema/
scope/recovery refusal, cross-schema dependency denial, missing-cascade rollback
and complete account/invitation/sign-in cleanup. Backend typecheck, focused
ESLint and formatting passed.

The new backup helper successfully captured, independently encrypted, restored,
hash-verified and separately loaded all four real database dumps. Only the newly
created local restore databases and exact fixture dump files were removed.
That preparation run did not delete accounts or stop hosted services; the later
execution checkpoint above supersedes it. No production code deployment or
physical device acceptance accompanied the maintenance.

Development resumed after the owner reactivated the goal following workstation
updates. Rust 1.99.0, Node 22.22.0 and pnpm 11.9.0 were rechecked; the existing
feature branch and uncommitted work were preserved. The earlier pause is saved in
[the saved handoff](handoff-2026-11-08.md). The final rotation/cursor checkpoint
passed `scripts/Test-RemoteCi.ps1 -NativeOnly`: formatting, warning-denied Clippy,
workspace regressions and release builds. Its synthetic cases exercise padded
non-square images in all rotations, monochrome AND/XOR masks, color alpha,
masked color, clipping, invalid shapes and retained/hidden pointer state. The
initial Clippy chunk-iteration warning was corrected before this passing run.
Documentation formatting/diff checks passed. No physical capture/input or
SYSTEM service/UI acceptance ran. Build/test sessions for that pause checkpoint
finished before updates; work remains saved and uncommitted.

## November 8 controller-label checkpoint and planning review

The worker now requests an acknowledged controller-label update before creating
or renewing its scope. Typed bounded UI requests carry only owner identity and
an acknowledgement channel, never HWNDs or arbitrary commands. The UI timer
checks the visible window/label/enabled Disable control and sign-in desktop;
timeout or render failure latches Stop. Late updates cannot overwrite failed
disable feedback or revive stopped authority. Text rejects control/bidi-spoofing
characters, and the label preserves literal ampersands. The window was enlarged
for wrapped identity/status text; actual DPI/secure-desktop rendering remains
unaccepted. No media transport was enabled.

Full native CI passed formatting, warning-denied workspace Clippy, workspace
regressions and release builds. Hidden owned-window checks and bounded queue
timeout/late-update tests passed; no SYSTEM window or real input/capture ran.
Missing Windows binding imports were corrected before the passing full run.

The owner's latest request is a roadmap-only review before resuming development.
[The roadmap](roadmap.md) now includes the requested appearance, Downloads,
Settings, outgoing-email and whole-product design pass, supplied viewport
criteria and a clean-slate reset of all Remote accounts and associated data,
including test accounts. The reset supersedes earlier retained-test-account
instructions, but no reset/deployment/UI redesign ran in this planning pass.
The hosted Downloads page could not be inspected through the web fetch; the
review used current source and approved design, not claimed live visual QA.

## November 8 lease discovery development

The native supervisor now requests discovery, separately signs/revalidates the
returned lease and delivers the strict authorization over its authenticated
private worker channel. It probes between bounded network requests and checks
local disable, session epoch and shutdown before delivery. Missing active leases,
replacement lease IDs or exchange failures close the worker; a different lease
requires a fresh instance. Ordered delivery followed by a fresh probe checks
worker processing, without claiming a connected peer. The machine key stays in
the supervisor. Network/IPC time consumes the original monotonic deadline.

Focused warning-denied native Clippy and sign-in regressions passed. Disposable
loopback HTTP fixtures check actual paths and signed proofs, refusal/redirect
and oversized-body rejection, strict explicit-null discovery and bound
authorization. An initial fixture failed because Windows accepted sockets
retained nonblocking mode; setting the owned fixture socket to blocking fixed
it. No production socket or device setting changed. Full native CI passed:
formatting, warning-denied workspace Clippy, workspace tests and release builds.
These fixtures do not prove SYSTEM cross-session delivery.
Heartbeats still report `workerReady:false` and public connectability is false.

Added `/api/signin/pending` with a distinct signed proof domain. It returns only
the current lease ID or null after the same live owner/browser/policy/worker/
console checks as authorization; it cannot renew a lease or grant media access.
Fresh valid proofs consume shared replay nonces even without a matching lease.
Separate fresh `/api/signin/authorize` validation remains mandatory. Discovery
responses carry `Cache-Control: no-store`. Supervisor requests/delivery now
exist as described above; viewer transport is not connected and native readiness
remains false.

Backend typecheck, focused ESLint and formatting/diff checks passed. The real
PostgreSQL authority regression passed with discovery key separation, domain
separation, replay, stale/strict proofs, absent leases, console/sign-in changes
and policy invalidation. The first attempt failed because loopback PostgreSQL
was offline. Docker Desktop was started and only Remote's existing development
PostgreSQL Compose service was started; the repeated test passed without skips.
No hosted services, physical devices or SYSTEM service installations changed.

## November 8 scoped input development

The full native CI script passed for the scoped-input source: formatting,
warning-denied Clippy, workspace regressions and release builds. A subsequent
extended monitor-info pointer correction passed formatting, focused Clippy and
sign-in regressions. The final standalone release command's session is no longer
available; its terminal result was not recovered, so it is not recorded as a
separate passing build.

An initial sign-in-only SendInput adapter now shares the opaque worker scope and
requires a connected peer, live lease, correct console/desktop and local Stop
state. Strict input envelopes bind lease/worker/console, version, scope and
increasing sequence. Clipboard and unknown capability fields are rejected.
Owned message buffers and parsed text use zeroizing cleanup; failures/logging
exclude typed contents. No arbitrary commands, UIAccess, token borrowing or
synthetic secure-attention path was added.

Primary-display input queries physical geometry in a restored thread-local DPI
context, checks monitor/virtual layout/rotation changes and bounds coordinates.
Held scan codes, buttons and Unicode operations are tracked before sends so
partial failures retain cleanup ownership. An independent watchdog releases idle
held state and ends expired/disconnected/silent scopes; retries send only ups on
the original permitted sign-in desktop. Failed cleanup stays unconfirmed rather
than injecting into a new desktop. The worker's owned shutdown grace now leaves
time for that bounded cleanup. Hiding or destroying the Disable window also
latches the current scope's Stop signal without raising standing permission.

Fake-sink regressions exercise idle release, expiry during a down event, Unicode
failure, replay, rejected clipboard, rotation changes, silent lanes, denied
cross-desktop cleanup and normalized-coordinate bounds. The real OS constructor
is tested only for missing-peer rejection. No actual input was injected. This
adapter is not started by the worker or wired to a live viewer; service/worker,
held-input, UAC/SAS, physical DPI/layout and handoff acceptance remain open.

## November 8 initial capture and lease scopes

The worker now accepts correctly bound private-IPC authorization into an opaque
native scope. Renewals cannot change lease/worker/console identity, revive expiry
or undo Stop. Worker-loop teardown ends authority held by surviving capture
clones. A separate peer-connected gate is mandatory before graphics access.
The strict backend-reply decoder rejects other scopes, mismatched proof fields
and forbidden capabilities, and anchors expiry before the HTTP request so that
network and IPC delay consume its lifetime. IPC uses absolute Windows precise
interrupt-time ticks rather than a timer started at reply receipt.

An initial primary-output DXGI source now selects the output's actual adapter,
uses nonblocking acquire/GPU map, bounds readback dimensions/stride and strips
padding into memory-only BGRA. Frame/map cleanup is owned; layout, access-loss,
release and authorization failures stop the scope and discard source resources.
No screen was duplicated. Current fixtures use synthetic bytes and scopes to
check padded rows, invalid dimensions, missing-peer rejection, delayed replies,
scope matching, expiry and Stop/owner teardown. No actual capture/input acceptance
or positive GPU/secure-desktop test is implied.

This adapter is not started by the worker or connected to the encoder/transport.
The latest checkpoint adds all four output rotations and bounded color,
masked-color and monochrome cursor composition with clipping and cached pointer
updates. Those paths use synthetic regression fixtures; actual GPU metadata,
orientation and pointer rendering have not been accepted on a device.
Scoped input, active controller UI, supervisor lease requests/delivery, peer/browser
transport and fresh ordinary-user handoff remain open. Readiness/connectability
remain false. The existing Windows bindings version was reused; Cargo.lock only
adds it to the agent dependency list, with no package-version upgrades.

Validation: full native CI passed with the DXGI source, strict reply decoder and
precise interrupt clock. Follow-up initialization-failure teardown and deterministic
deadline-boundary changes passed warning-denied Clippy, focused native regressions
and fresh workspace release builds. The initialization error now ends its scope,
preventing retries from silently retaining authority after graphics failure.
No database checks, device acceptance, service installation or production rollout
were run for this checkpoint.

## November 8 native development

The separate sign-in endpoint now has administrator setup, a third machine-DPAPI
identity, explicit file/directory/service ownership and ACL verification,
immutable hash-versioned executables, bounded repair/removal and forget/disable
integration. An exclusive maintenance lock serializes installation changes.
New services remain on-demand until their protected descriptor is verified.
Existing identities and prior executable versions are preserved during upgrades.

The SYSTEM Session 0 supervisor uses only its own duplicated, privilege-reduced
token to launch a fixed worker on the active locked console's Winlogon desktop.
It never borrows another process's token or changes desktop ACLs. The worker is
attached to a kill-on-close job atomically at process creation, disallows child
processes, and authenticates its exact supervisor over private IPC. Fresh
challenge probes, session notifications and worker-side input-desktop checks
end stale workers. Network/binding loss closes the worker; console transitions
require a new worker instance. Stop waits for the service process to exit.

Real NTFS/private-pipe and suspended current-user process fixtures cover protected
immutable files, maintenance exclusion, message framing/cancellation and atomic
job membership/termination. The process fixture never resumes its primary thread.
These checks do not establish SYSTEM cross-session launch or secure-desktop
acceptance. No service was installed and device testing remains paused.

Validation: the full native CI script passed formatting, warning-denied Clippy,
workspace tests and release builds with this service/worker implementation.
Subsequent console-transition/process-exit/timing adjustments passed focused
native regressions and warning-denied Clippy. Documentation formatting and
`git diff --check` passed. The live PR recheck still found the same nine open
PRs; none were changed. The private temporary credential record remains present.
Its database status recheck could not run because Remote's development PostgreSQL
port was offline and Docker Desktop's Linux-engine pipe was absent. No database
or credential was replaced; the November 7 successful account validation
remains historical evidence rather than a current database availability claim.

Media readiness is deliberately false. DXGI capture, scoped input, controller/Stop integration,
lease-to-worker integration, authenticated transport/browser
UI and fresh ordinary-desktop handoff remain required. See
[the implementation boundary](signin-authority.md).

Offline disable now uses fixed SCM request/confirmation controls. The supervisor
drops the worker before flushing a protected restart-persistent latch; failed or
corrupt writes never confirm disable or resume sharing. Ordinary repair preserves
the latch; explicit administrator setup is needed to clear it. Local policy
lowering and removal invoke this before network waits/UAC. Real filesystem
fixtures cover restart, confirmation ordering and failed/corrupt persistence;
Windows Authz evaluates the narrow interactive revoke right and denies network
and configuration/lifecycle escalation. No actual service control or physical
Stop acceptance was performed.

The stopped-supervisor persistence gap is now closed in source: administrator
enable creates a protected non-secret marker that interactive users may delete
but cannot write or recreate. Local disable removes it before contacting SCM;
missing markers block launch and ordinary repair preserves that state. The
filesystem restart regression and Windows Authz checks cover deletion, denied
recreation/sibling mutation and repair preservation.

The worker now creates its own guarded native Disable window before Ready.
Disable/close remove the enable marker; failed saving leaves retry visible with
the stop-request flag set. A UI timer checks the current sign-in desktop and
observes worker-owned close state without posting to stale window handles.
Current UI copy accurately says screen sharing is unavailable. Controller
identity and immediate media/input teardown remain to be integrated. No SYSTEM
window was opened; ordinary-identity/desktop rejection passed. A hidden ordinary
window fixture sends Close/Disable messages to its own procedure and verifies
that failed persistence retains the retry control and stops the scope flag;
worker-owned teardown closes it. Actual sign-in layout/operation, DPI and
secure-desktop acceptance remain unverified.

The full native CI script passed with marker/UI lifecycle source, including
warning-denied Clippy, workspace regressions and release builds. The subsequent
hidden-window regression and SCM persistence fallback passed focused native
regressions, warning-denied Clippy and fresh release builds. Documentation
formatting and diff checks also passed. Control-plane/device checks were not rerun.

## November 7 development

The owner paused device acceptance and requested development first, a live
branch/PR review and private temporary testing credentials. Device tests have
not resumed in this development session.

Implemented source:

- Separate default-off sign-in authority registry, canonical signatures and
  owner/browser/policy/process/console-bound short leases in additive migration 025. Boot and ordinary keys cannot substitute for the new identity. Sign-in
  presence cannot make the ordinary desktop online. The public readiness result
  explicitly remains `connectable:false`; no sign-in transport is exposed.
- Lease renewal, proof validation, owner disable/Stop, ordinary-controller
  collision protection and backend-restart/disconnect cleanup. Real PostgreSQL
  regressions exercise replay, account/browser isolation, console/process and
  Windows sign-in transitions, policy version changes, expiry and audit rollback.
- Native `signin_ipc` building block: SYSTEM-only local message pipe, exact
  live peer PID/session/SYSTEM checks, bounded typed lifecycle messages,
  impersonation restrictions, cancellation draining and permanent closure on
  protocol/I/O failure. Current-user Windows pipe fixtures passed; no SYSTEM
  service or cross-session worker was installed/launched.
- Fixed an inherited MFA regression that recalculated the supposedly replayed
  TOTP after a wall-clock boundary. It now resubmits the same step/code; actual
  account authentication behavior was not weakened. Corrected stale guest-support
  and Downloads descriptions discovered in the earlier UI walkthrough.
- A local temporary-account create/status/rotate/recover/remove tool. Credentials
  exist only under the external private root, with its restricted ACL, for
  Remote's loopback development database. The tool rejects repository/link paths
  and never prints credentials. The account remains present for later testing;
  rotate/remove it only when the full work is complete, as requested by the owner.

Validation: `pnpm check` passed formatting, lint, strict types, all enabled real
PostgreSQL/script/web regressions and backend/web builds. Follow-up credential
and schema-verifier edits passed focused formatting/lint/type checks. Local
`pnpm dev:setup` applied/verified the additive schema in Remote's development
database. `scripts/Test-RemoteCi.ps1 -NativeOnly` passed formatting, Clippy with
warnings denied, workspace tests and release builds with the native IPC source.
Native build concurrency was limited to two jobs. No production database was
used and no database checks were disabled.

The preceding readiness/build session verified Pixel ADB and Surfiena SSH,
passed the then-current native checks, and built/installed a fresh signed Android
APK on the selected Pixel. It did not complete the app walkthrough or physical
media/control acceptance. Its first `pnpm check` failed the inherited MFA test;
the corrected development run above passed. Neither that APK nor historical
Windows artifacts should be called a release of the present uncommitted source.

[Branch review](branch-review-2026-11-07.md): 66 live remote branches, including
55 retained branches with merged PRs and nine open PRs. The unattended branch
has no implementation PR. Dependency diffs were reviewed but not adopted;
MCP integration remains pending. Nothing was merged, closed, deleted or pushed.

**Development is not complete.** The November 8 section supersedes the earlier
service/worker implementation status. DXGI capture/scoped input, controller/Stop
integration, lease integration, peer transport/browser UI and fresh
ordinary-desktop handoff remain unfinished. The launcher uses the documented
named-pipe correction to ADR 0048's inherited-channel proposal. See
[the current contract and remaining native work](signin-authority.md).
Do not resume device acceptance, enable sign-in connectability, or claim full
unattended completion from these checks. The roadmap's later automation,
additional-platform and feature backlog is also not complete.

## November 1 historical checkpoint

Last verified for the following historical checks: November 1, 2026.

Current-branch dependency audits found no high/critical npm advisories, and RustSec `cargo-audit audit --deny warnings` passed for Cargo.lock using an official-release-digest-verified tool. The npm audit retains a moderate [minimatch development-tool advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249); its fix requires a major version change, which was not forced into transitive consumers. GitHub's warnings on the default branch describe its older dependency state; publication of this feature branch does not merge or deploy it.

The owner authorized publishing the existing unattended development, consolidating development secrets, making the workspace independent of C:/Dev and retiring verified obsolete copies after backup. No production deployment, new privileged sign-in endpoint or real-device/service/reboot acceptance was performed.

`pnpm check` passed: formatting, ESLint, strict TypeScript, real PostgreSQL route regressions and backend/web builds. The dedicated Remote `_test` database was used; database tests were not disabled. The inherited session test incorrectly required separately refreshed TURN credentials to be byte-identical across a one-second boundary. It now verifies each credential's opaque session binding, bounded expiry against the actual database cap and HMAC signature. The existing React-version regression now resolves actual packages instead of opening an assumed node_modules path. These changes protect the existing behaviors while supporting copied dependencies; no authorization control was weakened.

`scripts/Test-RemoteCi.ps1 -NativeOnly` passed native formatting, Clippy with warnings denied, workspace tests and release builds. Android unit tests, lint, debug app and instrumentation APK compilation passed in the preceding uninterrupted run; no instrumentation was installed/run during this maintenance. The inherited instrumentation source remains restricted to an isolated unpaired emulator.

Fresh dependency installs succeeded. Hoisted copied dependencies have no active source/dependency reparse points. Backend manual fixture Vite imports now use a declared existing-workspace dependency. Changed PowerShell scripts parse, and existing signing-information commands read the relocated signing files without printing values. The existing SSH alias worked with its relocated key. A stale October 12 C-path launcher owner record was archived only after checking its process lifetime and vacant ports. Local dev setup/schema verification, hidden backend/web startup/readiness and owned shutdown succeeded using the external private state directory.

Gitleaks scans of staged candidates are a pre-publication gate; private reports remain outside Git. Local development database dumps restored into separate disposable databases; production data was not touched.

The actual second-PC Windows service/boot/reboot/uninstall and physical Android/cross-network capture/control/file gates remain open. Initial Windows sign-in-screen control remains unimplemented under ADR 0048. Source publication is a development checkpoint, not release acceptance. See workspace.md for paths, keys/recovery boundaries and next development steps.
