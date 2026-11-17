# Remaining acceptance and completed evidence

Checkpoint: November 17, 2026. Use with the [parity roadmap](rdp-vnc-parity-roadmap.md)
and [next-agent handoff](next-agent-handoff.md). This ledger prevents repetition
of completed tests and prevents source-only checks being called acceptance.

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
