# Beacon Remote product roadmap (2026, revision 2)

Revision 2 updates the November 2026 roadmap with the evidence from the Pixel
re-pairing and control runs, the Surfiena blockers, and a competitor feature check.
Detailed capability notes stay in [rdp-vnc-parity-roadmap.md](rdp-vnc-parity-roadmap.md).
Test results stay in [testing-remaining.md](testing-remaining.md).

## 1. Goal

Beacon Remote lets people reach their own computers and Android phones from a browser,
and lets support teams reach computers they manage. Done means:

1. **Unattended trusted access** to the owner's Windows and Android devices. Once the
   owner has enabled trusted access on a device, a browser connects with no local click per
   session. The device can Stop and revoke at any time, and the revoke takes effect at once.
2. **Attended support** with explicit local approval, visible Pause and Stop, and separate
   grants for view, control, files, clipboard, printing, audio and recording.
3. **Daily-use parity** with RDP, VNC and support tools for everyday work: control,
   clipboard, files, multi-monitor, audio, reconnect and performance.
4. **Operator features** for teams: accounts with MFA, policy, audit, session ownership,
   fleet inventory, and a supportable release process.

Beacon may say "better than" a competitor only for a named task with published,
repeatable measurements (section 7).

## 2. Competitor feature check

Sources are vendor pages and reviews found on 19 November 2026. Vendor claims are
marked as such. Entries marked _unconfirmed_ need the current vendor documentation.

| Product                                       | Confirmed features (source)                                                                                                                                                                                                                                                                                                                                                                                                                                       | Notes for Beacon                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Microsoft RDP                                 | Clipboard and drive/printer redirection, multi-monitor, RemoteApp (publishes single apps)                                                                                                                                                                                                                                                                                                                                                                         | Needs a Windows Pro, Enterprise or Server host. Not available on Windows Home (our test). |
| RealVNC Connect                               | Unattended access (managed devices tier), two-way file transfer, multi-monitor windows, control of Android devices through its server app; iOS view-only ([RealVNC](https://www.realvnc.com/en/connect/), [RealVNC features](https://www.g2.com/products/realvnc/features))                                                                                                                                                                                       | Clipboard sharing _unconfirmed_.                                                          |
| TeamViewer                                    | Unattended access that starts with the OS, Wake-on-LAN, file transfer (box and side-by-side), remote management policies ([TeamViewer forum](https://community.teamviewer.com/English/discussion/6611/unattended-access-vs-wake-on-lan), [TeamViewer KB](https://www.teamviewer.com/en/global/support/knowledge-base))                                                                                                                                            | Remote Management feature list _unconfirmed_. Licensing claims not checked.               |
| BeyondTrust Remote Support (Bomgar)           | Session policies per portal or endpoint, separate attended and unattended policies, elevation to protected windows and UAC (Windows and Mac), chat log with permissions granted, session recording and reports ([BeyondTrust features](https://www.beyondtrust.com/products/remote-support/features), [session policies](https://beyondtrust.com/remote-support/features/session-policies), [docs](https://docs.beyondtrust.com/rs/v24.3/docs/web-collaboration)) | Strongest on support-team workflow and audit.                                             |
| AnyDesk, Splashtop, ConnectWise ScreenConnect | Unattended access, clipboard, reporting and multi-user administration (vendor claims from comparison sites)                                                                                                                                                                                                                                                                                                                                                       | Used as secondary references only.                                                        |

Where Beacon can be different by design (not measured as better):

- No client install: the viewer is a web page.
- Local approval, a visible indicator and a Stop on the device for every attended session.
- Separate grants for files, printing and recording that end with the connection.
- Android phones as hosts, with local approval and Pause/Stop.
- One inspectable permission model in the browser.

## 3. Capability matrix (status on 19 November 2026)

Status: **done** means implemented and tested on real hardware. **partial** means implemented
with known gaps. **missing** means not built. Hardware items need a device.

| Capability                                 | Windows (Surfiena)                            | Android (Pixel 7a)                                                                                            | Evidence                     |
| ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Attended view with local approval          | done                                          | done                                                                                                          | Pixel and Surfiena view runs |
| Attended control with local approval       | blocked (input test box did not show)         | done (ordinary control re-run after factory reset)                                                            | testing-remaining.md, 19 Nov |
| Unattended trusted access (no local click) | not enabled (owner click pending)             | connect passed 19 Nov; "no local click" to confirm with phone untouched                                       | M0 notes, 19 Nov             |
| Visible Pause, Stop and local revoke       | done (Stop)                                   | done (Pause, Stop)                                                                                            | earlier runs                 |
| Remote typing into an editable field       | not tested                                    | done (Chrome address bar, 19 Nov)                                                                             | M0 notes, 19 Nov             |
| Control expiry and lease loss              | not tested                                    | done (deadline ends session; lease loss = Wi-Fi drop test, 19 Nov)                                            | M0 notes, 19 Nov             |
| Accessibility loss detected and shown      | n/a                                           | done (session ended, unattended off, notice shown, 19 Nov)                                                    | M0 notes, 19 Nov             |
| Lock screen behaviour                      | not tested                                    | done (session ends on lock, 19 Nov)                                                                           | M0 notes, 19 Nov             |
| Resume after network change                | partial                                       | done (unattended: 8, 15 and 40 s drops resume with video; over 2 min, Stop during a drop end it, 19 Nov)      | M0 notes, 19 Nov             |
| File send device to viewer                 | partial                                       | done (1 MiB, hash match, 19 Nov); resume untested                                                             | M0 notes, 19 Nov             |
| File send viewer to device                 | partial (download)                            | done (3 MiB, hash match, 19 Nov); resume untested                                                             | M0 notes, 19 Nov             |
| Clipboard device to viewer                 | done (Windows), done (Pixel)                  | done                                                                                                          | —                            |
| Clipboard viewer to device                 | missing (ADR 0021 forbids; approved decision) | missing                                                                                                       | needs ADR change             |
| Multi-monitor selection                    | partial                                       | n/a                                                                                                           | —                            |
| Audio output                               | missing                                       | done for attended shares (owner setting, off by default; tone reached the viewer, 19 Nov); not for unattended | ADR 0054                     |
| Microphone input                           | missing (approved decision)                   | done for phone-to-viewer (owner switch on the phone; unattended, locked, 20 Nov); viewer-to-phone not built   | ADR 0057                     |
| USB forwarding                             | missing (approved decision)                   | missing                                                                                                       | needs hardware               |
| Printing redirection                       | partial (code, not tested)                    | n/a                                                                                                           | —                            |
| Wake-on-LAN and boot-to-online             | missing                                       | missing                                                                                                       | competitor parity            |
| Sign-in screen control                     | source only                                   | n/a                                                                                                           | needs hardware               |
| Session recording with consent             | missing                                       | done (owner allows on the phone; recorded in the viewer's browser, 19 Nov)                                    | Pixel run                    |
| Chat during a session                      | partial (handoff baseline)                    | done (viewer message arrives as a notification, reply from the notification returns to the viewer, 19 Nov)    | Pixel run                    |
| Session policy per device and per portal   | partial (per device)                          | partial (per device)                                                                                          | —                            |
| Elevation to protected windows and UAC     | missing                                       | n/a                                                                                                           | competitor parity            |
| Independent sessions and RemoteApp         | missing                                       | n/a                                                                                                           | needs Windows Pro or Server  |

## 4. Milestones

Each milestone has an exit gate. Evidence goes into [testing-remaining.md](testing-remaining.md).

### M0. Environment with no blockers (now)

Exit gate: both devices run the next test with no owner click except the consent the
product requires.

- Pixel: screen timeout 30 minutes (done 19 Nov). Accessibility and restricted settings
  allowed (done). Unattended access for the owner's account: owner decision.
- Surfiena: trusted access on the Beacon host window (owner click, device-side).
  Input test box opens visibly and takes focus in the signed-in session from one command (done 19 Nov).
  Finding (19 Nov, read-only inspection): the probe does start in session 1 and wrote
  `input-probe-e48fe6c7.json` at 17:24 (closed, 9 key-downs, not focused, text not matched).
  The later task run exited 1 because the script refuses an existing probe id. Fixed in
  `Windows-InputProbe.ps1` (raises the window on show): a run with a fresh probe id reported
  `focused: true` in session 1. Rule: use one fresh probe id per run.
- Environment check (19 Nov): Pixel 7a `34171JEHN07672` over ADB is awake and unlocked with
  Beacon accessibility enabled and screen timeout 30 minutes. Surfiena SSH works with
  explorer running in session 1.
- Pixel unattended access enabled 19 Nov by the agent on the owner's instruction (it failed
  while the backend was down). The isolated acceptance backend was restarted with
  `docker start` (same config, fresh one-hour lifetime) at 17:51 local; it expires about 18:51.
- Pixel unattended connect run (19 Nov, 17:55 local, harness `pixel-connect-2026-11-18.mjs`): the
  viewer connected with live relayed video (324x720, first frame 2.5 s) and control ready;
  approval was reported in 484 ms; Stop ended the session and profile cleanup was confirmed.
  The agent sent no tap on the phone; the owner was nearby, so confirm "no local click" on the
  next run with the phone untouched. Not yet covered: reboot, accessibility loss, lock, expiry.
- Pixel accessibility loss (19 Nov, 17:55, run with the same harness): while a control session was
  live, Beacon's accessibility service was removed with `settings put secure
enabled_accessibility_services ''`. The session ended within about 5 s, unattended access was
  switched off, and the app showed "Unattended access is off. Accessibility permission was
  removed." with an Enable accessibility button. Passed. The service was then restored and
  unattended access re-enabled by the agent.
- Pixel remote typing (19 Nov, 17:59): with unattended access and the Chrome address bar as the
  editable field (focused by a remote tap through the viewer), the test word "beacon" typed
  through the Beacon keyboard channel appeared in the field (checked by screenshot). Passed.
  A first attempt typed before the field had focus and did nothing, so the harness must tap and
  confirm focus first. Chrome was set to "Stay signed out" with notifications declined; nothing
  was searched or saved. No debug app was needed (roadmap decision 4 is moot).
- Pixel lock-screen run (19 Nov, ~18:05): inconclusive. The connect request ended about 100 ms
  after the phone joined signaling, with approval pending and no frames, before the phone was
  locked. Cause not yet found (backend log shows the session ended at the host signaling
  handshake). The phone was then locked over ADB and awaits the owner's unlock. Rerun with the
  phone unlocked and Beacon in the foreground.
- Pixel lock-screen rerun (19 Nov, ~18:10): passed. Connected with unattended access (video 324x720,
  control ready), then the phone was locked over ADB (power key); the session ended within 6 s and
  the viewer showed ended. The earlier failed attempt came with Beacon not in the foreground after
  Chrome clean-up; the rerun started with the Beacon app in front. Cause of the first failure is
  still a hypothesis. The phone is locked again and needs the owner's unlock.
- Pixel reboot (19 Nov, ~18:20): passed. `adb reboot`; the owner unlocked the phone once after boot
  (Android needs the credential after a restart; the agent did not enter it). With the launcher in
  front and the Beacon app not opened, Beacon's service was running with accessibility still on,
  and an unattended connect gave live relayed video (324x720, first frame 3.1 s, approval 744 ms)
  with control ready. Stop ended it cleanly. Android unattended after reboot = done, with one
  owner unlock per boot as the platform requires.
- Pixel control expiry (19 Nov, ~18:09): passed. During a live unattended control session the one
  session row's `expires_at` was set to now+40 s in the isolated acceptance database only (same
  machine, status active; the backend's minimum configurable limit is 1 hour, so a real wait was not
  practical). Video was live (236 frames) until the deadline, then the viewer showed ended and
  frames stopped. This tests the server deadline reaching the host, not a real 12-hour wait.
- Pixel file transfer both directions (19 Nov, ~18:12-18:14, attended): unattended access was turned
  off for this run (the viewer offers Files only in an attended session). The consent prompt showed
  the test account, "Also allow receiving files" was ticked, Allow once was tapped, and Android's
  Share screen confirmation was accepted (all taps by the agent over ADB, on the owner's
  instruction). Viewer to phone: 3,145,728-byte fixture sent, phone copy in Downloads/Beacon Remote
  matched SHA-256 80e8d42a... (copy then deleted). Phone to viewer: 1 MiB random file chosen through
  the notification's Send file and the system picker; viewer Save received it and SHA-256 04d4104a...
  matched. Both passed. Not tested: resume of an interrupted transfer. Viewer wording bug: the
  phone's offer reads "The computer wants to send ..." Unattended access was re-enabled afterwards.
- Pixel hands-off unattended run (19 Nov, ~18:30): the agent sent no taps and no keys to the phone
  during the run. Beacon's main screen held focus the whole time, the log showed no consent or
  screen-capture activity, and the viewer reached live video (324x720, 31 frames) with control
  ready. This is the "no local click" evidence for Android (the owner was in the room but was
  not asked to touch the phone). Stop ended it cleanly.
- Pixel setup script (19 Nov): `scripts/acceptance/Setup-Pixel.ps1 -Action Prepare|Status [-Apk path]`
  installs an update, allows restricted settings, grants notifications, adds Beacon's
  accessibility service without removing others, sets a 30-minute screen timeout, exempts Beacon from
  battery optimisation and prints a status. It never types the passcode, pairs or enables unattended
  access. Minimal Pixel workflow: owner once = pair code + "Enable unattended access"; owner per boot
  = unlock; everything else is the script. Tested idempotently on the paired Pixel.
- Web wording fix: the phone's file offer now reads "The phone wants to send ..." (typecheck and
  Prettier pass; no existing test referenced the text).
- OPEN BUG, Pixel intermittent connect failure (19 Nov, 18:05 to 18:38): about every other
  unattended connect from the harness ends within seconds with zero frames (success, fail, success,
  fail; earlier runs at 17:53 to 17:59 passed back to back). Phone log of a failing run: the input
  channel reaches CONNECTING, then "Session ended: Authorization lapsed" 3 s later, then "Signaling
  failed ... Broken pipe". Backend log: the session is ended at the signaling handshake. Not caused
  by Wi-Fi changes, the phone being locked, or waiting 45 s after the previous Stop. The lease
  (3 s, renewed every 1 s) is the likely link. Needs root cause before auto-resume is built, because
  a resume would hit the same fault. The 8 s Wi-Fi drop test could not be completed for this reason.
- Root cause of the connect bug (19 Nov, ~18:45): a race. An unattended phone starts sharing at once
  and sends its first lease renewal about 1 s later. If the browser's signaling socket has not
  attached yet, the backend's renewal handler (`apps/backend/src/sessions.ts`, the `!viewer` branch)
  ended the session. Backend log of failing sessions showed `viewerState: null` with the machine
  still renewing. Fix in source (not deployed): a 10 s first-attach allowance
  (`viewerAttachGraceOpen`), used only before any viewer has ever attached; later viewer loss still
  follows the reconnect rules. Test `apps/backend/test/viewer-attach-grace.test.ts` (node:test, passes
  with the silence tests); backend typecheck passes. Needs deployment to the isolated acceptance
  backend and an alternating-run recheck before it counts as fixed.
- Fix deployed to the isolated acceptance backend (19 Nov, ~18:55 local): commit a35029e exported
  with `git archive`, unpacked under `/opt/beacon-remote/source-snapshots/<commit>`, image built from
  `infrastructure/oracle/Dockerfile.backend` and tagged `beacon-remote-acceptance-backend:<commit>`, a new
  last override `/etc/beacon-remote/acceptance-images-<commit>.override.yaml`, and only the
  acceptance backend recreated (compose project `beacon-remote-acceptance`, existing config chain).
  Nothing was pushed to GitHub; production and the web container were not touched. Verification is
  incomplete: run 1 of 8 connected (video + control); the phone then locked itself at its 30-minute screen
  timeout, so runs 2 to 8 (phone log "phone is locked", then "Declined") do not test the fix. The phone is
  now set to stay awake while plugged in (`stay_on_while_plugged_in=3`, also in Setup-Pixel.ps1).
  Repeat the alternating connects once the owner has unlocked the phone.
- Connect-race fix verified on the Pixel (19 Nov, ~19:05): with the phone unlocked and awake, eight
  back-to-back unattended connects on the deployed backend (a35029e): 7 reached live video with control
  ready (324x720, 9 to 15 frames at the 19 s sample); run 3 was still "connecting" at 19 s and had not
  ended (a slow start, not the old fail-with-zero-frames). Before the fix about every other run ended at
  once. Verdict: the race is fixed for the failure seen; the slow start in run 3 is not explained
  (the sample is small) and is worth a longer-wait recheck. Not pushed.
- Pixel 8 s Wi-Fi drop on the fixed backend (19 Nov, ~19:10): the session ended and did not resume.
  Phone log: signaling socket failure then "Session ended: Connection lost"; the backend also finishes a
  session when the host socket closes. The viewer already reconnects, so auto-resume needs host-side
  changes on both Android and the backend. Design written in [host-reconnect-design.md](host-reconnect-design.md);
  awaiting owner approval and two answers (window length; attended sessions).
- Auto-resume build log (19 Nov, 19:00 to 20:45): the phone now waits 20 s after a lost connection, retries every
  2 s and re-attaches (log: "Connection lost; waiting", then "Reconnected after a short network loss", about 10 s after
  an 8 s Wi-Fi drop). Backend fixes found by testing: (1) accept the re-attach over a stale socket (a dead network sends
  no close), (2) replace the stale socket before the slot check (first version terminated the new socket), (3) let the
  viewer resume while the phone is re-attaching (it used to be refused, and the viewer then stopped the session),
  (4) give each reconnect its own relay credentials (relay error 486, allocation quota, blocked the new media path).
  Not yet proven end to end: after (4) the one gated run ended 4 s after the drop with the viewer, not the phone,
  sending Stop (cause not found), and later connects stayed at "connecting" with no media, which looks like the relay still
  holding allocations from the repeated drop tests (about 10 minutes each). Next: wait for the allocations to expire, rerun
  a single 8 s drop, and capture the viewer's own status text to see why it stops. Commits up to 30ee585, pushed;
  acceptance backend runs 30ee585; Pixel runs the matching signed build.
- Owner decisions 19 Nov (later): the Pixel is a dedicated test phone (screen lock removed by the owner); remote
  unlock by typing the passcode in the viewer each time (never stored), subject to a feasibility test of whether Android
  lets Beacon see and touch the lock screen; after a reboot nothing can run until a first unlock, so a no-lock phone is
  the way to auto-reconnect after reboot; clipboard viewer to phone is Off / Button only / Auto sync, default Button only.
- Pixel network drop (19 Nov, 17:58): Wi-Fi turned off over ADB for 20 s during a live control
  session. The session ended (it did not resume), consistent with the backend's 15 s silent-host
  rule; a new connection is needed after the network returns. Passed as a clean teardown;
  automatic resume stays a gap (capability matrix: resume after network change = partial).
- Not testable by the agent alone (19 Nov): control expiry (backend `SESSION_MAX_HOURS` minimum is
  1 hour, default 12; needs a bounded config change or a wait), lock screen and Pixel reboot
  (the phone needs its passcode, which the agent does not have; owner unlocks).
- Surfiena trusted access: in the host window press "More options", then choose "They can view
  and control without asking" (view-only: "They can view without asking"). Still needs the Beacon host window in session 1.
- Acceptance backend lifetime raised to 4 hours by owner decision (19 Nov): override
  `/etc/beacon-remote/acceptance-lifetime-4h.override.yaml` (last in the compose chain). Stop it by hand
  when testing is done: `sudo docker stop beacon-remote-acceptance-backend`. It still stops itself after 4 h.
- Owner decisions 19 Nov: push everything and deploy to the acceptance VM (done, branch at 284f13f);
  build auto-resume, full clipboard, audio, recording and chat on Android; make setup and daily use
  minimum-click; stay connected through lock and reboot with full trusted access chosen.
- (Superseded) Acceptance backend: the one-hour expiry was an owner decision.
- One runbook: owner one-time steps and each run's command in one file.

### M1. Unattended trusted access

Exit gate: with trusted access on, the owner opens a machine from the browser and gets
video and control with no local click. Stop and revoke on the device end the session at once.
Audit records who connected and when.

- Windows: trusted access survives reboot and sign-in; host starts in the signed-in session;
  each session checks server policy.
- Android: unattended control after a Pixel reboot; accessibility loss detected and shown.
- Both: control expiry, lock screen behaviour, resume after a dropped network.
- Wake-on-LAN and boot-to-online (competitor parity, TeamViewer) start here.

### M2. Daily-use features

Exit gate: each feature passes a scripted task on both platforms, with timings.

- Remote typing and shortcuts, tested in a debug-only text field on Android and in the
  Surfiena test window.
- File transfer both directions with resume and integrity checks.
- Clipboard viewer-to-device: plain text behind a device approval first, then rich formats.
- Multi-monitor selection, resize and DPI.
- Audio output; then microphone (its own consent).
- Printing on Windows.

### M3. Support-team features (Bomgar and TeamViewer parity)

Exit gate: an admin sets policy for a group, sees every session, and exports the audit log.

- Session policies by device, group and portal, with separate attended and unattended rules.
- Elevation to protected windows and UAC on Windows, with its own consent.
- Session chat with a log of permissions granted and revoked.
- Session recording with consent and playback.
- File box and side-by-side file transfer.

### M4. Reliability and performance

Exit gate: measured latency, frame rate and reconnect time against a published task list.

- Pause, Stop and reconnect under packet loss and network change.
- Frame-rate and latency measurement with a fixed test pattern.
- Clear error reasons on the device and in the browser.

### M5. Team operator features

- Accounts with MFA and single sign-on; roles; per-machine policy; session ownership.
- Audit export and retention; fleet inventory with device health.

### M6. Platform reach

- Windows Pro, Enterprise or Server test host for the RDP and VNC comparison (hardware).
- Independent sessions and RemoteApp (decide: native or RDS gateway interoperability).
- Native Windows session attach for a session with no logged-in console user: only after a
  security review of a SYSTEM service (approved decision; review first).
- Linux and macOS hosts (not started).

### M7. Automation and handoff

- Scoped, revocable automation credentials for an AI agent, with a view-only adapter already in source.
- Semantic UI trees and computer-use input, with the same consent model.

## 5. Blockers and how this roadmap handles them

| Blocker                                  | Why                                      | Handling                                                                        |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| Surfiena local click per approval        | Product consent model                    | Trusted access turned on once by the owner (M0). Attended tests keep the click. |
| Input test box does not show             | Launcher runs hidden and non-interactive | Fix the launcher in M0. Log startup.                                            |
| One-hour acceptance backend              | Runbook safety limit                     | Owner decision (section 6).                                                     |
| RDP and VNC comparison needs Windows Pro | No such machine                          | Hardware. Comparison rules in section 7.                                        |
| Remote typing target                     | Settings search row is not editable      | Debug-only text field app (owner approval, section 6).                          |

## 6. Owner decisions

1. Turn on trusted access on Surfiena for the test account (device-side, one click).
2. Turn on unattended access for the Pixel's owner account (device-side).
3. Whether the acceptance backend may stay up longer than one hour.
4. Approve the debug-only text field app for Pixel remote-typing tests.
5. Clipboard viewer-to-device: confirm the ADR 0021 change, with device approval.
6. SYSTEM service for native session attach: review now or after M2.
7. Whether to buy or borrow a Windows Pro, Enterprise or Server machine for the RDP and VNC comparison.

## 7. Comparison rules

Beacon may state "better than" for a named task only when:

- the same two machines, network and task list are used for each product;
- at least five runs per product, with median and spread;
- raw numbers and build versions are published with the claim.

Until then the claim is "measured" or "different by design", never "better".

## 8. Working rules

- Every change ships with the smallest test that protects the behavior.
- Every device test is recorded in [testing-remaining.md](testing-remaining.md) with build and hardware.
- Development checkpoints are committed and pushed to the feature branch. Deployment to a
  shared server is a separate, explicit step.
- Destructive actions on devices (wiping accounts, reinstalling) need an owner request.

## Pixel results, 19 November (late): auto-resume and clipboard

- Host re-attach window raised from 20 s to 2 minutes (server `HOST_RECONNECT_MS`, phone `RECONNECT_WINDOW`),
  because Wi-Fi reassociation on the Pixel takes 10-15 s after a drop.
- Two causes of a lost session during a 15 s drop were fixed: the server ended a resumable unattended session
  when a dead network sent no close (it now detaches the host instead), and the browser viewer forgot it was
  resumable while the phone was away and stopped the session when the phone returned.
- Pixel, isolated acceptance backend (`447c615`), Wi-Fi off then on, same session, no click: 8 s drop resumed with
  video, 15 s drop resumed with video, 40 s drop resumed with video. Still to test: a drop longer than the window
  ends the session, Stop during a drop, lock during a drop, accessibility removed during a drop.
- The relay (`total-quota=20`, `user-quota=4`) holds allocations for about 10 minutes, so many quick tests in a
  row produce TURN error 486 and no video. That is the test environment, not the resume code. Space tests out.
- Clipboard, text, both directions: phone setting Off / Button only (default) / Automatic in the Beacon app;
  viewer shows "Copy from phone" and "Send clipboard to phone". The phone announces its setting only after the
  viewer sends `clipboard_hello`, so older viewers keep working. Pixel, Button only: text sent from the viewer
  landed on the phone clipboard and read back identical (25 characters). Automatic and Off, rich formats and the
  ADR 0021 wording change are not done or not device-tested yet.

- Chat with a phone (19 Nov): a viewer line goes over the open control channel; the phone shows a notification with
  a Reply box and sends the answer back on the same channel. Nothing is stored. Pixel run: message arrived, reply
  returned. Needs control to be open; a view-only session has no chat yet.
- End-of-session cases (Pixel): a drop longer than 2 minutes ends the session; Stop during a drop ends it and the
  phone now ends at once when the server refuses its re-attach instead of retrying for the whole window.

## Android setup redesign (19 Nov)

- The paired screen opens with a Setup checklist: notifications, Beacon accessibility, access without asking, and
  permission to keep running in the background. One "Next step" button does the first unfinished step; when all four
  are done the list says "Setup complete: this phone is ready" and the button goes away. The existing unattended
  access controls and their safety checks are unchanged; the new button calls them.
- A pairing link `beaconremote://pair?code=...&server=...` opens the app with the code filled in. The person still
  taps Pair, so a link alone never pairs a phone. The workspace page does not show this link or a QR code yet.
- Pixel run: all four steps showed as done; with the background permission removed the list showed "3 of 4 done"
  and a "Keep Beacon running" button. Not yet run on a freshly reset phone, so first-time pairing from the link and
  the accessibility step on a clean install are untested.

- The workspace "Add a computer" panel now shows "Open this link on the phone" and "Copy link" under the code. The link
  carries the address and the one-use code. Opening it on the paired Pixel resolves to the app and is ignored without
  a crash (a paired phone never re-pairs from a link). Filling the code on an unpaired phone is not device-tested yet;
  a QR code is not built (it would add a dependency).

- Clipboard modes on the Pixel (19 Nov): Automatic wrote the browser's clipboard to the phone with no button press
  (page focus triggered it). Off disabled the viewer's send button and the phone logged no clipboard writes.
  Phone-to-viewer automatic copy was not exercised (the phone's clipboard could not be changed from this setup).
  Rich formats (images, HTML) and the ADR 0021 wording change are still open.

- ADR 0053 (device clipboard sharing) records the Off / Button only / Automatic decision, the text limits and the
  hello handshake. Windows keeps ADR 0021 behavior until it gets the same setting. Rich formats remain open.

- Recording with consent on the phone (19 Nov): the viewer's "recording" request now reaches the phone as "Allow this
  viewer to record your screen?" with Decline and Allow recording. After Allow, the viewer's Record button appears,
  shows "Recording" with a clock, and saves a .webm in the viewer's browser; nothing is stored on the phone, and the
  permission ends with the connection. Pixel run: request, allow, 4 s recording and saved file all worked.
  Playback inside Beacon and recording of audio are not built.

- Phone sound (19 Nov, ADR 0054): "Share phone sound" is an owner setting in the Beacon app, off by default, for
  attended shares only. The phone captures what apps play (Android playback capture) and sends it as an audio track;
  the microphone is never passed on. Pixel run: a 440 Hz tone from the system media player arrived in the viewer
  (Web Audio peak 0.37 for a 0.366 tone). Chrome's own sound is not capturable, as Android requires. Not yet tested:
  Pause with sound, long sessions, and the viewer's unmute button with a real person listening.
- Remote unlock (type the passcode in the viewer each time) is waiting on the owner: it needs a screen lock set on the
  Pixel and the owner to type the passcode, which the agent will not do. Nothing is built.

- Remote unlock (20 Nov, ADR 0055): "Unlock from the viewer" is an owner setting, off by default. Pixel with a test PIN:
  an unattended session connected to the locked phone and showed the live lock screen, and a viewer tap was delivered
  on it. Android shows the PIN screen as black to every screenshot, so the viewer has its own number pad ("Unlock
  phone") that sends one key at a time (0-9, Delete, Enter); the phone presses the matching key through the
  accessibility tree (keys readable on the Pixel). The agent never presses digits. Keys through the pad are not
  confirmed on the device yet: the first try returned "no pad" until the service was allowed to see views Android
  marks as not important and to search all windows (fixed, untested).
- Bug found and fixed (20 Nov): an app update turned unattended access off, because the accessibility service
  unbinding during the update cleared the setting. It is now cleared only when Android no longer lists the service
  as enabled. Fixed in the build installed 20 Nov; the next update should keep the setting.
- The isolated acceptance backend stops itself 4 hours after it starts; it had stopped overnight and phones show as
  offline until `docker start beacon-remote-acceptance-backend` and about a minute for the phone to reconnect.

- Remote unlock, Pixel result (20 Nov): after the service was allowed to see all windows and the PIN screen's tree was
  walked by hand, Delete pressed from the viewer's pad returned "ok" on the locked phone (the phone found its PIN
  screen, which was brought up by one swipe). The passcode itself is entered by the owner on the pad; that last step
  is pending the owner's run. The pad is laid out as a 3x4 grid. Clean build `d61e61dc` (diagnostic removed) is
  built but not yet installed, to avoid ending the owner's open test session.

- Surfiena (20 Nov, ~13:10 local): SSH to `beacon-surfiena` (100.97.59.85) timed out, so the laptop is asleep, off or
  off the network. No Windows work was possible; the owner step (trusted access on the Beacon host window) is still
  pending as well.

- Update keeps unattended access (20 Nov, Pixel): build `d61e61dc` was installed over the previous build while the
  phone was locked; afterwards an unattended session connected with no re-enable step and the viewer's passcode pad
  opened. This confirms the fix that clears unattended access only when Android no longer lists the accessibility
  service. The passcode itself (entered by the owner on the pad) is still the one untested step of remote unlock.

- Formatted (HTML) clipboard text, Pixel (20 Nov): the viewer sends the browser clipboard's HTML (up to 6,000
  characters, in pieces) before the plain text; the phone sets a formatted clip, and its formatted reply is written to
  the browser as formatted text beside the plain text. Round trip: `<b>rich-test-text</b>` went to the phone and came
  back as `text/html=<b>rich-test-text</b>` with `text/plain=rich-test-text`. Images and files are still not shared;
  they need their own decision. The phone must be in Button only or Automatic, as for plain text.

- M4 baseline, Pixel 7a, unattended, relayed (TURN) over Wi-Fi, locked phone, 20 Nov (five samples from the viewer's
  diagnostics): picture 324x720 at 0.7-2.4 fps (the designed unattended cap is 2 fps), round trip 41-125 ms, first
  presented frame 2.5 s, approval 0.9 s. Not measured yet: attended frame rate (the screen-capture path, expected
  well above 2 fps), tap-to-picture latency, direct (non-relayed) paths and a cellular network.

- Decisions drafted for the owner (20 Nov): ADR 0056 (image clipboard: yes for images, button press only, no
  files) and ADR 0057 (microphone: phone microphone to the viewer as a per-request permission, never unattended,
  never while locked; viewer microphone to the phone later). Both are marked proposed. Nothing is built for either
  until the owner says yes or changes them.

- Owner decisions, 20 Nov: (1) all clipboard content is shared when the clipboard setting is on, no limit by type
  (ADR 0056, replaces the proposal); (2) a viewer with trusted access can hear the phone's microphone, no per-request
  prompt, including unattended and locked (ADR 0057, replaces the proposal); (3) the viewer can see and interact with
  the lock screen. For (3): the lock screen is visible and touch works (done); Android shows the PIN screen as black to
  every capture, so interaction with it is through the viewer's passcode pad (Delete confirmed; the owner enters the
  digits).
- Microphone, Pixel (20 Nov): owner switch "Microphone for trusted viewers" (off in a fresh install, turned on here).
  With it on, an unattended session on the locked phone carried an audio track; the viewer's Web Audio peak was 0.13
  with a tone playing near the phone against 0.04 with it paused (ambient noise). The sharing notification reads
  "... - Microphone is on" and the service runs with the microphone type. Not yet tested: Pause and Stop ending it,
  Android 14+ behaviour when started from the background on other phones, and a mix with phone sound in an attended
  share.

- PIN screen stand-in (20 Nov): Android hides the PIN screen's picture from every capture, so the phone sends its
  layout (captions and positions of the credential area only, about once a second while the viewer's "Unlock phone"
  panel is open) and the viewer draws it: "Enter PIN", the entry area, the keypad, Delete, Enter and Emergency. Its keys
  press the real keys through the phone's accessibility tree, and the phone swipes up once to bring the PIN screen up
  if it is not showing. Pixel: the stand-in drew the keypad in its real positions on the locked phone. It cannot show
  how many digits were entered (Android does not expose that), and it is not the real picture. Pattern and password
  locks need their own pads (not built).
- Image clipboard, Pixel (20 Nov): a PNG copied in the browser reached the phone (427 bytes, written through the app's
  file provider). The return trip failed while the phone was locked: Android lets only the focused app or the keyboard
  read the clipboard, so the phone answers "unavailable" on a locked screen. The phone-to-viewer direction needs an
  unlocked phone and is untested.

- Pattern and password lock screens (20 Nov, built, not device-tested): the phone reports which credential screen is up
  (PIN, pattern or password). For a pattern the viewer shows a 3x3 dot grid; the person clicks the dots in order and
  the phone draws one finger path through the grid's cell centres. For a password the viewer shows a password box and
  the phone types it into the lock screen's field through the accessibility tree and presses its Enter action. Neither
  is stored or logged, and both need "Unlock from the viewer" on. Unit tests cover the message shapes and the
  viewer's validation. A device test needs the Pixel's lock changed to a pattern or password, which is the owner's step.
  The PIN stand-in was re-checked on the Pixel after the refactor.

- Clipboard from the phone, an Android limit (20 Nov): since Android 10 only the focused app or the keyboard may read
  the clipboard. On the locked Pixel the phone answered "unavailable" for text and for an image. It worked earlier
  (text, formatted text) only while the Beacon app or the phone was in the foreground and unlocked. So phone-to-viewer
  copying (text, images, files) is reliable only on an unlocked phone with Beacon in front. Options for the owner:
  (a) accept it and say so in the viewer ("Unlock the phone to copy from it"); (b) have the service bring a
  transparent Beacon screen to the front for a moment to read the clipboard, which needs testing on an unlocked phone
  and may be blocked by Android's background-launch rules; (c) leave phone-to-viewer copy as best effort. Viewer-to-phone
  copying is unaffected (the phone writes, it does not read). Copied files are not built: a browser cannot put a file on
  the system clipboard, so a copied file would arrive as a download; this waits on the choice above.

- Clipboard read via a brief invisible screen (20 Nov, built, not installed or tested): when Android refuses a
  background read, the phone shows `ClipReadActivity` (transparent, no animation, not in recents) for a moment, reads
  the clipboard there (text, formatted text, image up to 1.5 MB) and closes it. Only on an unlocked phone; if Android
  blocks the launch, the phone answers "unavailable" as before. Build `28118b39`. It needs an unlocked Pixel to test
  (the owner's unlock), including with another app in front. Copied files are still not built.

- Copied files from the phone (20 Nov, built, not installed or tested): when the phone's clipboard holds a file that is
  not an image, the phone offers it through the existing files channel and the viewer saves it as a download ("The
  phone offered the copied file. Use Save to keep it."); a browser cannot put a file on the system clipboard, so this
  is the closest equivalent. It follows the same Android rule as other clipboard reads (unlocked phone, brief
  invisible screen). Build `821085fe`; both this and the invisible screen need an unlocked Pixel to test. Files copied
  in the browser to the phone are not possible (a browser cannot read files from the clipboard); the viewer's Send file
  button remains the way to send files.

## Deferred until the owner is at the devices (20 Nov)

Each item is built and pushed; the test needs a step only the owner can do. Pick them up in this order.

1. Unlock the Pixel, then install build `821085fe` (or newer) and run, with another app in front of Beacon: copy text
   from the phone to the viewer; copy an image; copy a file (arrives as a download); then lock the phone and confirm the
   phone answers "unavailable" rather than failing.
2. Passcode stand-in: with the phone locked and the stand-in open, click the PIN digits and Enter (the agent never
   enters them) and confirm the phone unlocks. Delete was already confirmed through the pad.
3. Pattern and password lock screens: change the Pixel's lock to a pattern, then a password (owner step), and try the
   viewer's pattern grid and password box.
4. Surfiena: wake it and put it on the network (SSH to 100.97.59.85 times out); then the owner step on its Beacon host
   window (trusted access), and the Windows rows of the capability matrix.
5. Not started: viewer microphone to the phone; attended frame rate and tap-to-picture latency (M4); Android
   Enterprise managed-device unlock (needs the Pixel reset, so it is the owner's call).

- Permissions log in the viewer (20 Nov, M3): each device answer to a files, control or recording request is listed
  under "Permissions this session" with the time and outcome (allowed, declined, cancelled, expired), newest last, kept
  in the page only. Unit tests cover the wording and the 50-entry limit. It records what the device did; a server-side
  audit export is still M5.

- Recording playback (20 Nov, M3, built, not device-tested): after a recording stops, the viewer still saves the file and
  now also offers "Play last recording" (a player in the page with "Save again"). The recording stays in the page only
  and is released when replaced or when the page closes. Not yet tried on a real recording, which needs the device
  owner's approval on the phone.

- Clipboard from the phone, Pixel results (20 Nov, build 821085fe, phone unlocked): text copied in the Google search
  app (Beacon in the background) arrived in the viewer ("copied-on-the-phone-777", 23 characters); an image sent from the
  viewer to the phone came back to the browser clipboard as image/png (427 bytes). The read worked without needing the
  invisible screen to be proven separately. Still untested: a copied file (arrives as a download), the locked-phone case on
  this build (known to answer "unavailable"), and a real recording with the new player.

- Recording with the new player and the permissions log, Pixel (20 Nov, 14:11 local): after "Allow recording" was
  tapped on the phone (the owner's consent, tapped by the agent on the test phone), the viewer recorded 3 s and saved
  a .webm; "Play last recording" appeared in the toolbar and the permissions log read "Recording: allowed on the
  device" with its time. The player itself (pressing the button and watching the clip) was not exercised. Android's
  microphone indicator was showing because the microphone switch is on.

- M4, attended frame rate, Pixel 7a over the relay on Wi-Fi (20 Nov, 14:15 local): with a continuously animating page
  on the phone, three one-second-spaced samples of WebRTC `framesDecoded` gave about 40 then 53 frames per second
  (counts 402, 645 and 965 across two 6 s gaps), no dropped frames, picture 576x1280. A static home screen delivered
  about 1 frame per second (the capture sends frames when the screen changes), so the viewer's own "Presented FPS"
  reading is not a good measure on a still screen. Round trip 49-281 ms across samples. Unattended stays at its 2 fps
  design cap. Still not measured: tap-to-picture latency, a direct (non-relayed) path, cellular.

- Pause silences the microphone, Pixel (20 Nov, 14:19 local, unattended, microphone switch on): with a tone playing
  near the phone the viewer's Web Audio peak was 0.070; after "Pause" was tapped in the phone's sharing notification the
  viewer showed "paused" and the peak was exactly 0; the notification read "Sharing is paused" with a Resume action.
  Stop ended the session. Not tested: resuming restores the microphone, and Stop releasing it (the service stops, so the
  recording does too).

- Resume restores the microphone, Pixel (20 Nov, 14:22 local): Pause gave a viewer peak of exactly 0 (notification
  "Sharing is paused", Resume and Stop actions); tapping Resume returned the viewer to "viewing" and the microphone
  to the room's background level (peak 0.0045, matching the 0.0046 measured before pausing). The tone was not playing for
  this run, so the comparison is silence (0) against background noise (about 0.005), not against a loud sound.

First pass done (20 Nov): the toolbar is now a slim header (status dot, device name, "Connected / Paused / Connecting /
Ended" and access in plain words, a Tools button and the one red Stop button, always visible). Every other control moved
into a Tools drawer that slides in from the right (full width on phones), one control per row with large touch targets;
Scale, Sound, Keyboard, access request, Back/Home/Recents, clipboard, Unlock phone, chat, Full screen, Send file,
recording and Connection details are all there, so the picture now has the whole screen. Checked on the live Pixel at a
desktop window and at 390x844. Still to do from the plan: group the drawer into labelled sections (Navigate, Clipboard,
Files, Chat, Record, Unlock), permission requests as a sheet, clearer paused/ended overlays, a light theme, and
before/after screenshots kept with the docs.

- Pairing screen seen (20 Nov) on an Android Studio emulator (Beacon_Phone, fresh install of build 34008453): "Pair this
  device." headline, Paste code from clipboard, Device name, Pairing code, Server address link and a Pair device button,
  all in the light palette. Actual pairing was not done there; the Pixel's pairing was not touched.
  Second pass (20 Nov): the drawer is grouped under labels (View, Control, Clipboard, Lock screen, Message, Files, Access)
  in a fixed reading order, connecting, paused and ended are one calm card in the middle of the picture (spinner while
  connecting, "Paused" label), the Play button is a pill at the bottom, and the phone-width header no longer overlaps.
  Deliberately still dark only: the viewer is a video surface. Emulator check: an Android Studio emulator paired to the
  test workspace (not production) shows the lock type "PIN" after a viewer opened its unlock pad; its pattern lock was
  not detected by the viewer (the Android emulator's lock screen is not the Pixel's), so the pattern path stays proven on
  the Pixel only.

- File transfer resume, phone to viewer (20 Nov, built, not tested): the viewer already asks to carry on from a byte
  offset with the hash of what it holds; the Android sender ignored that and always started over. It now skips the
  first bytes only if their SHA-256 matches what the viewer sent, otherwise it answers "failed / resume" (the viewer
  tells the person to ask again). Build `82ffe422` compiles, passes the Android unit tests, installs, and a normal file
  send from the viewer still works on the Pixel. An interrupted phone-to-viewer transfer that is then resumed has not
  been run; it needs a deliberate break (for example Wi-Fi off mid-transfer) and the viewer's Resume download button.

- File transfer resume, phone to viewer: a real interrupted run (20 Nov, 14:30, Pixel) showed the viewer never offered
  "Resume download". A 120 MB file offered by the phone was cut by turning Wi-Fi off for 10 s; the session resumed itself,
  but the viewer discarded the partial copy and showed a fresh Save, because its resume logic needs the phone to give
  each offer a stable `transferId` and to report it in the files channel's ready message (`downloadTransferId`) after
  reconnecting, and the Android sender sent neither. Fixed in `6b8679bb` (same file, same id; the id is cleared when the
  viewer finishes, declines or cancels it), on top of the earlier sender-side resume at an offset with a hash check.
  A second interrupted run on the new build is pending (the relay had to clear first).

- Android app redesign (20 Nov, from the owner's mockup `beacon-remote-rebuilt.html`): three tabs (Device, Access,
  Privacy) with a bottom bar; the Device tab has a session card (Not sharing / Sharing / Paused / Offline, with Pause,
  Resume and Stop sharing) and three summary rows; Access has the "Connect without asking" and "Unlock from a viewer"
  switches (the second dimmed while the first is off, and asking first before it is turned on) and a tappable setup
  checklist; Privacy has the clipboard as Automatic / Button only / Off plus Phone sound and Microphone switches. The
  "more" menu holds Connection details and Remove device, each in a bottom sheet; the request screen is restyled
  ("Someone wants to see your screen", Allow touch and typing, Allow receiving files, Decline / Approve once). Light
  palette from the mockup, with a matching dark one. All behaviour and test hooks (`access-toggle`,
  `availability-toggle`, `consent-allow`, `consent-decline`, `pair-submit`) are kept. Checked on the Pixel: all three tabs
  in light and dark, the more sheet, the unattended switch end to end. Not yet seen on the device: the request screen,
  the sharing and paused states, the pairing screen and the remove and unlock confirmation sheets (the Pixel lost its
  Wi-Fi, so no request could be made). Left out of the mockup on purpose: the "Preview" items, which were mockup only.

- Android redesign, device check (20 Nov, Wi-Fi back): the request screen ("Someone wants to see your screen", Allow
  touch and typing, Allow receiving files, Decline / Approve once), the Device tab while sharing (blue card, "Connected",
  Pause and Stop sharing) and while paused (grey card, Stop and Resume, and the viewer showed "paused") all work on the
  Pixel, and the Access tab shows the unlock row dimmed while access without asking is off. Fixed from that run: the
  light "Stop sharing" and "Resume" labels were invisible in dark mode. Still not seen on the device: the pairing screen,
  and the Connection details and unlock-confirmation sheets.

- Android guided setup (20 Nov): the Device tab now shows a "Finish setup" card until setup is done: a four-segment
  progress bar, the next step named with one sentence on why, and one button that does it. Steps run in the order
  notifications, accessibility, background running, access without asking. Background running uses Android's own
  one-tap "Let app always run in background?" dialog (Pixel: tap, Allow, done; the settings list is the fallback).
  Accessibility asks Android for Beacon's own page (this Pixel ignored that and showed the general list, where Beacon
  is the first entry; the fallback is built in), and the card carries a "restricted setting" hint with an Open app info
  link for sideloaded installs. After each step Android sends the person back, and the next step starts by itself.
  Pairing has "Paste code from clipboard", which reads either the whole link or just the one-use code (never pairs by
  itself). Pixel run: background and accessibility steps were done from the card; unit tests cover the code parser.
  Not yet tried on the device: the paste button, a fresh install with the "restricted setting" block, and the
  notification and access steps from the card.

## Viewer redesign (added 20 Nov at the owner's request; second pass done 20 Nov)

Redesign the whole web viewer screen, its buttons, UX and UI, in the same system as the new Android app (paper and ink,
one blue, large tight headlines, bottom sheets, one clear action per step). The owner's screenshot of a live phone
session shows what is wrong today:

- One crowded toolbar holds about 20 controls in a row (Sound, Keyboard, Choose access, Request access, Back, Home,
  Recents, Copy from phone, Send clipboard to phone, Unlock phone, a message box, Full screen, Send file, Connection,
  Stop control) with no grouping, so nothing says which matter most, and it wraps ("Send message" drops to a second line).
- Controls that belong together are scattered: phone navigation (Back, Home, Recents), clipboard (two buttons), lock
  screen (Unlock phone), chat (a text box in the toolbar), files and recording.
- A blue "Play video" button sits on top of the phone's picture, covering part of it; the device name is cut off
  ("Pi...") and the session facts are tiny grey text.
- The phone picture is a narrow strip in the middle of a large black area; the controls do not follow the picture.
- Sound shows as a big white button while the rest are small dark ones; the primary action (Stop control) is red and
  alone at the far end, away from the picture.
- Permission requests, the passcode pad, the permissions log and recordings appear as extra rows under the toolbar.

Plan: (1) a design pass from the owner's mockup style for desktop and phone-width browsers; (2) a header with the
device name, state and one Stop control; (3) grouped, collapsible tools (Navigate, Clipboard, Files, Chat, Record,
Unlock) in a side panel or sheets instead of a toolbar; (4) the picture centred and sized to fit, with a clear
connecting, paused and ended state; (5) permission requests as a sheet with plain wording; (6) keyboard and touch
targets checked, light and dark; (7) before and after screenshots on a desktop window and a phone-width window.

- File transfer resume, phone to viewer, PASSED on the Pixel (20 Nov, build 6b8679bb+): a 120 MB file offered by the
  phone was cut mid-transfer by turning Wi-Fi off for 10 s. The viewer showed "Download interrupted... Reconnect to
  resume", the session resumed by itself, the phone offered the same file again and the viewer's button read "Resume
  download" (earlier builds showed "Save" and threw the partial copy away). Pressing it finished the file: the viewer
  reported "Received" and the phone logged "done" after the SHA-256 check. This closes the earlier open item.

- M4 tap-to-picture latency, Pixel 7a over the relay on Wi-Fi (20 Nov, 20:00 local): a viewer tap on the phone's tab bar
  until the picture changed (frame-hash change in the viewer, 10 ms polling). Unattended (2 fps cap): 327, 439, 438,
  416, 456, 359, 462, 627 ms, median about 440 ms. Attended: one run 160 ms for the first tap but the next taps did not
  change the picture or took 2.4 s (taps lost or delayed); a second run 595, 283, 716, 492, 476, 481, 1518, 1425 ms.
  So a typical attended tap shows in about 0.3-0.7 s, with occasional 1.4-2.4 s outliers and some lost taps that need
  a look (the viewer's tap is a down/up with no hold). Still not measured: a direct (non-relayed) path and cellular.
- Redesigned Android sheets checked on the Pixel (20 Nov): Connection details and the "Allow remote unlocking?"
  confirmation both render correctly in dark mode and work; the unlock setting was restored afterwards. The pairing
  screen is still unseen (it needs the phone unpaired), and copied files from the phone's clipboard still need a source
  app that can put a file on the clipboard: adb cannot set the clipboard on this Pixel.

- QR code for phone pairing (20 Nov): the workspace's "Add a computer" panel now draws a QR code of the pairing link next
  to the code, so a phone's own camera opens the Beacon app with the address and code filled in (the person still taps
  Pair). No new dependency: a small encoder in `apps/web/src/qr.ts` (byte mode, error correction M, versions 1-10).
  Checked: module-for-module against a reference encoder for every size it was compared on, and decoded with OpenCV for
  sizes from version 1 to 10 including Unicode. That check found and fixed a real bug (two timing-pattern modules were
  overwritten). Unit tests keep three verified codes as checksums. Not yet scanned with the Pixel's camera.
- Android roadmap status (20 Nov): done and tested on the Pixel are the redesign and guided setup, auto-resume,
  clipboard (text, formatted text, images), recording with consent, phone sound, microphone, chat, file resume both
  ways, QR/link/paste pairing helpers, and the M4 baselines. Left, each needing a human or hardware step: the pattern and
  password lock tests (the owner changes the Pixel's lock and enters it), the passcode entry on the viewer pad (owner),
  the pairing screen on a freshly unpaired phone (needs unpairing and a new code), a copied file on the phone's
  clipboard (needs an app that can copy a file), a direct (non-relayed) path and cellular measurements, attended taps that
  are sometimes lost or slow (needs a closer look), Android Enterprise managed unlock (resets the Pixel), and the viewer
  microphone to the phone (not requested by the owner). Surfiena (Windows) is separate and was unreachable all day.

- Lock type on the Access tab (20 Nov, build 3e3c9a54): Android does not tell an ordinary app which kind of lock a phone
  has (only whether it is secure), so Beacon learns it from the credential screen: each time it finds the PIN, pattern or
  password screen it remembers the kind (never the credential) and the Access tab shows "Lock type: PIN (last seen ...)",
  "not seen yet", or "no screen lock". Pixel: installed; before any lock the line read "not seen yet". A locked unattended
  session with the unlock pad open was run so it should now read PIN; reading it needs the phone unlocked (owner).

- Lock type line, confirmed on the Pixel (20 Nov): after a locked unattended session with the unlock pad open, the
  Access tab reads "Lock type: PIN (last seen 1 hour ago)". Pattern and password detection are still to be seen on a
  real lock (the owner changes the Pixel's lock).

- Pattern lock detection, Pixel (20 Nov): with the Pixel's lock switched to a pattern by the owner, the first test showed
  the viewer still waiting ("Bringing up the PIN screen"): on this Pixel the pattern grid's id is `bouncer_pattern_root`
  (title "Draw pattern"), not the `lockPatternView` the code looked for. Fixed (build 34008453) and, for the password
  screen, the text box is now found by class as well. Retest: a locked unattended session with the unlock pad open now
  shows the viewer's 3x3 dot grid with "Draw pattern" and "Clear" instead of the number pad. Not yet done: drawing the
  pattern (the owner enters it), the Access tab reading "Lock type: Pattern" (needs the phone unlocked), and the password
  lock.

- Lock type on a pattern lock, confirmed on the Pixel (20 Nov): after the pattern fix, a locked session with the unlock pad
  open showed the dot grid in the viewer and, once the owner unlocked the phone, the Access tab read "Lock type: Pattern
  (last seen 3 minutes ago)", so the line follows the lock when it changes. Still to be seen: the owner drawing the pattern
  from the viewer's grid, and a password lock.
