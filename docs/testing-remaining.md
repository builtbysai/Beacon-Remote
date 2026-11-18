# Remaining acceptance and completed evidence

Checkpoint: November 17, 2026. Use with the [parity roadmap](rdp-vnc-parity-roadmap.md)
and [next-agent handoff](next-agent-handoff.md). This ledger prevents repetition
of completed tests and prevents source-only checks being called acceptance.

For P0-4 Windows files and recording, request each from a connected view-only
session. Confirm the local prompt names only that scope, defaults to Decline, and
that approval shows the sharing card entry. Verify the viewer enables files only
after approval, delivered bytes match, and Turn off file and recording access stops
an in-flight transfer while control and video continue. Repeat with Decline, cancel,
expiry, Pause and Stop, and confirm a reconnect restores view-only consent.

For P0-4 Windows control on Surfiena, request control from a connected
view-only session. Confirm the local prompt offers only mouse and keyboard,
defaults to Decline, and closes on cancellation, expiry, lock, Pause or Stop.
After approval verify the local indicator reports control, input works on the
test target, and release occurs on channel loss. Verify the original view can
recover without the added control, and a new control request needs consent.

For P0-4 Android incoming files, start a view-only session without files.
Request file transfer while video plays. Confirm the upload control stays
hidden until the phone's Allow files action and the relay confirmation.
Repeat with Decline, Cancel, timeout, lock, Pause and Stop. Check unauthorised
offers are refused and that an approval during one viewer connection cannot
be reused after reconnect. Verify the delivered file hash and receiver
cleanup on interruption. Include a mixed-version viewer and backend check.

For P0-4 Android control, begin a view-only session from an eligible viewer.
Request control with accessibility enabled and confirm ignored input until
local approval and the matching relay confirmation. Check one active input
channel, tap and typing after approval, and immediate input release on Pause
and Stop. Repeat with decline, expiry, lock, accessibility loss, reconnect
and a helper whose original invitation permits viewing only.

For P0-3 Android consent on device, leave the OS capture picker open while the
viewer cancels and requests again. Verify a fresh local prompt is required,
and the old picker or notification cannot approve the replacement. Repeat with
rotation, late notification delivery and Go offline while consent is pending.

For P1-5, use the viewer's **Keyboard** button with a real dead-key layout,
AltGr and an IME. Verify composed text reaches Windows and Android once, Enter
follows the final committed text, and Escape or focus loss cancels unfinished
composition. Check shortcuts separately in the normal video input mode and
verify the mobile soft keyboard still works.

For the Android reconnect gate, test initial negotiation, a temporary network
loss, viewer reload within the original authorization, and reconnect after
Stop or expiry. Confirm screenshots and remote actions wait for the connected
generation and live lease. Verify a delayed callback from the previous peer
cannot resume sharing or restore its control indicator. Interrupt an incoming
file after the last data chunk and before publication, then verify the pending
file is discarded when authority is lost.

For P1-3, exercise a backpressured upload on real devices. Check viewer Cancel,
host Pause, disconnect and an unresponsive send buffer independently. Confirm
the viewer settles promptly on interruption or after the 30-second drain
timeout, that subsequent selected files do not start, and that the receiving
endpoint discards or retains its partial file as appropriate. Verify interrupted
Windows uploads still resume when the receiver retained matching bytes.

Pixel 7a live permission upgrades (November 18, 2026, acceptance backend,
signed build `99d3739`): with Bedtime on, the prompt reaches the ongoing sharing
notification as well as the request channel. Decline reported "declined" in the
viewer. Allow files delivered a 3 MiB file with a matching SHA-256. Allow control
first failed because the phone registered its channel observer after the input
channel was already open, so the screen-size message was never sent and the viewer
stayed view-only; the fix sends it when the channel is already open. After that, a
remote tap opened the Google search box and typed text arrived. Pause from the
ongoing notification moved the viewer to "paused" with control still granted
(twice). While paused, the test viewer could not place a click on the video
(something covers it), so no tap reached the phone from the viewer; the phone's
own refusal of input while paused was not exercised. One run ended with
"Authorization lapsed" about 80 seconds in, right after the phone had moved from
one Wi-Fi network to another; the lease needs a reply within 3 seconds. Not yet
tested on the phone: control expiry, lock, accessibility loss, reconnect after a
network change, mid-transfer Pause/Stop and Pause then a fresh offer.

Android P0-3 now checks the dedicated **While sharing** notification channel as
well as the app-wide notification setting. Android unit/lint/build checks passed.
The guarded Android API 36 emulator test removed the channel while app-wide
notifications remained enabled and verified that real screenshot frames stopped.
The physical acceptance matrix should
exercise both switches independently. With general notifications still enabled,
turn off **While sharing** in Android Settings before an attended request, during
the capture prompt, and during live attended and unattended sharing. Verify
refusal or teardown as applicable, disabled remote input and files, a terminal
backend session, and no continued capture. Restore the channel through Settings
and verify the ended session cannot resume. Use a separate fresh consent request
to verify attended recovery.

## Latest source-only continuation

The owner resumed development after the documentation checkpoint. `be832b2`
fixes delayed clipboard input after release and stale viewer modifiers. `2fd40a3`
also releases paced Enter/Tab when replacing a paste, including a denied clipboard
read. Channel
regressions failed before the fix and passed afterward; the full web suite/build,
workspace typechecking, lint, formatting and frozen install passed. Add delayed
clipboard permission/Escape/Stop and held-Shift focus loss to the next physical
Surfiena unit; this does not close its acceptance row below. No device state was
freshly inspected or changed. `754f585` removes the moderate minimatch advisory
through TypeScript-ESLint 8.73.0; full audit still fails on high picomatch with no
published patch, while production audit is clean. Keep PR #126 draft.

## Completed physical sequences: do not restart from zero

- Surfiena: signed native startup acknowledgement 208 ms; owner confirmed quick
  Online, Start/Stop toggle and no new terminal. Ordinary view-only video, relay,
  browser Stop/backend end/profile cleanup passed. Ordinary Windows input remains open.
- Pixel: readable pairing; same-signer updates preserving pairing; attended video,
  real browser touch/typing, local Pause/Resume/Stop, backend end and capture teardown.
  Initial view-only first frame was 1467 ms after approval; later control 853 ms.
- Pixel: repeated prompt-free owner connections; competing controller refused 409;
  local Disable ended sharing; fresh request required approval and Decline supplied
  no video/control. Paused typing did not change a focused field and frames stayed
  at 141; Resume restored frames and the same typing worked.
- Pixel: real lock ended sharing and removed capture. Owner subsequently unlocked.
  Accessibility removal during sharing ended video/input and removed CaptureService;
  restoring the service did not restore unattended permission. A fresh request was
  presented and declined. No security setting was written to bypass Android consent.
- Rotation: old viewer failed repeatedly. `c22dc2f` fixes a later display message
  being misrouted to the pending clipboard handler. Regression tests failed before
  the fix and passed after it, including coordinate remapping and clipboard refusal.
  Actual Pixel 324x720 -> 720x324 -> 324x720 stayed connected; landscape typing and
  a far-right clear-field tap worked. This used locally built static assets in an
  owned browser against the real isolated backend; VM viewer remains `0bba353`.
- Signed Android `1afcc9e`: permission-revocation status now says access is off,
  replacing the stale earlier enabled notice. Actual repeated revoke/status review
  passed. Same signer SHA256 `003eaaad33a9ba2e20304a5c3a69cc1a26289bb72a9d1000cbcf81ee0357a0f6`.
- Pixel received `beacon-acceptance-20261117-file.txt`, 3,145,728 bytes, through Beacon;
  actual SHA256 matched `80e8d42a5dd2bfe0c29937412b9ba0edf578f1cf89b49fb9e73aaf1dff4e8178`.
  The harmless file remains in Download/Beacon Remote. Do not claim it was deleted.

These are short physical sequences, not sustained performance or complete platform
acceptance. The old private refusal fixture wrongly required `ended` instead of
`denied`; its newer explicit expected-terminal option passed the refusal sequence.
Successful later runs confirmed backend terminal state and owned profile cleanup.

## Next complete test units, in order

| Priority | Unit to finish                                         | Required terminal evidence                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Now      | Restore the intended Pixel test setup after revocation | Read real service state; enable only Beacon accessibility through normal Android UI if needed; confirm unattended remains off until deliberately enabled. Do not use UIAutomator on the owner's phone.                                                                                                              |
| P0       | Normal Surfiena control                                | Matching signed fixture, local approval, moving decoded video, typing/pointer/shortcuts, held modifier/mouse release on Stop/Disconnect/expiry, local revoke; no residual capture/input/task/profile.                                                                                                               |
| P0       | Installed Windows unattended lifecycle                 | Explicit admin installation, per-user startup and independent service identities; cold boot/signed-out/locked states; actual supported sign-in worker capture/input, secure attention, unlock-to-desktop handoff, relock/restart/recovery. Test both Home and authorized Pro/reference hardware where applicable.   |
| P0       | Installer/service lifecycle                            | Clean install, repair, upgrade, rollback, crash/reboot recovery, service/binary drift, disable while offline, cancelled admin step, uninstall/forget/re-enroll; no inherited access or relocated runtime identities. Encrypted recovery first where required.                                                       |
| P0       | Android permission matrix                              | Notification denial/revoke, accessibility off/on, cancelled/expired/duplicate OS capture prompts, view-only versus control/files, local offline/Disable, backend revoke/logout/expiry, backgrounding/screen-off, permission loss mid-transfer and app update/restart. Confirm exact scopes and no silent re-enable. |
| P1       | Network/reconnect                                      | Direct and forced relay; different real networks, Wi-Fi/mobile/VPN/proxy/firewall/IPv6; packet loss/flaps, browser reload/close/reopen, process/backend restart, TURN renewal/capacity, no stale generation/controller or resumed revoked lease.                                                                    |
| P1       | Files/clipboard                                        | Windows both directions and stream/resume; Android cancel/refuse/duplicate/storage-full/large-file/interruption/no-permission. Clipboard real apps/formats, Unicode, unavailable clipboard, unsolicited reply rejection; new format/directory/drive features require implementation first.                          |
| P1       | Displays/input                                         | Windows multiple monitors/mixed DPI/rotation/hotplug/headless; Android attended MediaProjection rotation as well as already checked unattended path; physical control across bounds, layouts/IME/dead keys/AltGr/Unicode/touch/pen; new features require source first.                                              |
| P1       | Audio/recording/chat/handoff                           | Audible Windows loopback with separate consent, mute/Pause/Stop/lease/revoke; no microphone without its new capability. Record only with approval, announcements, local file completion; chat/history/operator handoff and single controller.                                                                       |
| P1       | Power and performance                                  | Actual wired-neighbor WoL/firmware/no-neighbor refusal; sleep/resume/restart. Sustained decode/encode/input latency, load/CPU/RAM/bandwidth/GPU fallback and reference RDP/VNC runs; include failure/recovery percentiles.                                                                                          |
| P2       | Public product/ops                                     | Remaining auth/public/viewer routes; real account lifecycle/MFA/export/deletion and email delivery/client rendering; keyboard/screen-reader/200% zoom/narrow/short/DPI/touch; signed public artifacts, rollback, production backup/independent restore, both products' readiness.                                   |
| P2       | Retention/security                                     | Retired identity reconnect/re-enroll, provider/historical-backup retention, scoped agent abuse/replay/isolation, no credentials/pixels/input in logs, dependency/security gates. Rotate/delete temporary account only at full completion.                                                                           |

For each unit: inspect existing evidence; prepare only its owned fixture; exercise
the real action; test refusal/revoke; stop it; verify backend and device teardown;
write the sanitized result immediately. Save failed/blocked evidence too. Finish
that sequence before broadening the run. Commit checkpoints before context is
exhausted; do not launch a large undifferentiated suite without a bounded end state.

## Current blockers and limits

- Draft PR #126. At `1afcc9e`, CI `44144389550` passed Android/native/security and
  functional control-plane checks; dependency audit failed. Earlier `c22dc2f` run
  `44142823589` has the same audit-only failure. High picomatch advisory
  GHSA-fc5q-39xc-vjpf had no published fix when checked; recheck authoritative
  upstream, do not manufacture 4.0.8 or waive the audit without a reviewed remedy.
- Automatic approval review rejected replacing the isolated VM web container,
  with only “blocked by policy.” No retry through another tool/route was made.
  The local-static browser test was a separate test, not a VM deployment. New VM
  viewer activation needs a permitted path; production/native feeds remain unchanged.
- The one-hour isolated backend has expired and is stopped, as intended. Do not
  remove the legacy STOP marker. Its replacement bounded preparation is separate.
- Pixel was observed unlocked with availability on, capture off and accessibility
  off at the documentation handoff. A restoration was not confirmed; inspect again.
  That was the prior documentation checkpoint; no device tests or OS changes ran
  in the subsequent source-development continuation either.
- Real-device install/admin/firmware prompts, hardware audio observation and any
  unavailable reference hardware remain genuinely human-dependent where tools
  cannot complete the supported OS flow. The owner supplied a development Pixel
  unlock credential, so do not repeatedly call its ordinary PIN entry a blocker.

## Phone-to-viewer file offer (November 17, 2026, evening)

Pixel 7a `8e6ad65` (release, same signer) on the isolated acceptance backend with
the 0bba353 viewer, relayed route. The owner's temporary passcode was used for the
device unlock. Consent with "receive files" checked; the phone's Send file action
opened the system picker; the 3,145,728-byte test file was offered as `send`, the
viewer accepted and saved it, and the SHA-256 of the received copy matches the
phone's source (80e8d42a…). Sharing was then stopped from the notification.
Earlier attempts that failed are recorded in the commit history: the first run
had no Send file action (notification built before the channel opened); a
second run cancelled because the picker's read grant expired (fixed with a
persistable grant released when the transfer ends). Still open: a
mid-transfer Pause/Stop/cancel check on the phone and sending over a direct route.

### Pause mid-transfer (November 17, 2026)

Pixel 7a release `8e6ad65`, 150 MB test file (157,286,400 bytes) offered from
the phone's sharing notification. The viewer accepted and streaming began; the
phone's Pause action stopped the stream at once (sender log: stopped with
allowed=false, cancel sent). The viewer showed "Cancelled" and its downloads
folder held no partial copy. Still open: Stop mid-transfer, direct route, and a
Pause that resumes into a fresh offer.

### Stop mid-transfer (November 17, 2026)

Same 150 MB offer on `8e6ad65`. Stop from the sharing notification ended the
session during the stream; the viewer reported that the file could not be
received because the connection closed and the partial copy was discarded, and
its downloads folder held no partial file. Pause and Stop mid-transfer now pass
on this relayed route. Still open: direct-route runs and a Pause followed by a
fresh offer.

### Clipboard copy from the phone (November 17, 2026)

Pixel 7a `77673ca` (release, same signer), accessibility control enabled for
Beacon Remote, isolated acceptance backend with the locally built viewer assets.
The phone's clipboard held a 22-character probe. The viewer's "Copy from
computer" request reached the phone; the phone log records "Clipboard read
requested: returned 22 characters" and sends that text back on the input
channel. The viewer's browser then refused the write with "Allow clipboard access
in your browser", because the automated test window lacked focus and clipboard
permission for that write. Still open: confirm the viewer copy in a focused
browser tab, and the reverse direction (viewer to phone paste) is typed input
only.

### Direct route (November 17, 2026)

The isolated acceptance backend normally forces relay-only ICE. For this run its
ICE transport policy was set to `all` through a compose override (the acceptance
container was recreated with the same compose layers; the override was removed
afterwards and the backend returned to `relay`). A Pixel 7a session (release
`77673ca`) with the locally built viewer reported the selected candidate pair as
`prflx / srflx` (a direct path, not a relay), with decoded frames advancing from
57 to 67 across two samples. The viewer's route label showed "Unavailable" for
this pair, which is a labelling gap to fix. Still open: a direct run on a second
network, and Windows direct-route acceptance.

### Clipboard copy from the phone, focused viewer (November 17, 2026)

Pixel 7a `77673ca`, accessibility control on, isolated backend on relay policy,
locally built viewer with its page brought to the front and clipboard
permission granted for the test origin. The phone's clipboard held a 22-character
probe. "Copy from computer" produced the viewer notice "Copied from the computer."
and the browser clipboard read back the probe text exactly. The earlier refusal
was the unfocused automated window, not a product fault. Viewer-to-phone paste
remains typed input.
