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
marked as such. Entries marked *unconfirmed* need the current vendor documentation.

| Product | Confirmed features (source) | Notes for Beacon |
| --- | --- | --- |
| Microsoft RDP | Clipboard and drive/printer redirection, multi-monitor, RemoteApp (publishes single apps) | Needs a Windows Pro, Enterprise or Server host. Not available on Windows Home (our test). |
| RealVNC Connect | Unattended access (managed devices tier), two-way file transfer, multi-monitor windows, control of Android devices through its server app; iOS view-only ([RealVNC](https://www.realvnc.com/en/connect/), [RealVNC features](https://www.g2.com/products/realvnc/features)) | Clipboard sharing *unconfirmed*. |
| TeamViewer | Unattended access that starts with the OS, Wake-on-LAN, file transfer (box and side-by-side), remote management policies ([TeamViewer forum](https://community.teamviewer.com/English/discussion/6611/unattended-access-vs-wake-on-lan), [TeamViewer KB](https://www.teamviewer.com/en/global/support/knowledge-base)) | Remote Management feature list *unconfirmed*. Licensing claims not checked. |
| BeyondTrust Remote Support (Bomgar) | Session policies per portal or endpoint, separate attended and unattended policies, elevation to protected windows and UAC (Windows and Mac), chat log with permissions granted, session recording and reports ([BeyondTrust features](https://www.beyondtrust.com/products/remote-support/features), [session policies](https://beyondtrust.com/remote-support/features/session-policies), [docs](https://docs.beyondtrust.com/rs/v24.3/docs/web-collaboration)) | Strongest on support-team workflow and audit. |
| AnyDesk, Splashtop, ConnectWise ScreenConnect | Unattended access, clipboard, reporting and multi-user administration (vendor claims from comparison sites) | Used as secondary references only. |

Where Beacon can be different by design (not measured as better):
- No client install: the viewer is a web page.
- Local approval, a visible indicator and a Stop on the device for every attended session.
- Separate grants for files, printing and recording that end with the connection.
- Android phones as hosts, with local approval and Pause/Stop.
- One inspectable permission model in the browser.

## 3. Capability matrix (status on 19 November 2026)

Status: **done** means implemented and tested on real hardware. **partial** means implemented
with known gaps. **missing** means not built. Hardware items need a device.

| Capability | Windows (Surfiena) | Android (Pixel 7a) | Evidence |
| --- | --- | --- | --- |
| Attended view with local approval | done | done | Pixel and Surfiena view runs |
| Attended control with local approval | blocked (input test box did not show) | done (ordinary control re-run after factory reset) | testing-remaining.md, 19 Nov |
| Unattended trusted access (no local click) | not enabled (owner click pending) | connect passed 19 Nov; "no local click" to confirm with phone untouched | M0 notes, 19 Nov |
| Visible Pause, Stop and local revoke | done (Stop) | done (Pause, Stop) | earlier runs |
| Remote typing into an editable field | not tested | done (Chrome address bar, 19 Nov) | M0 notes, 19 Nov |
| Control expiry and lease loss | not tested | done (deadline ends session; lease loss = Wi-Fi drop test, 19 Nov) | M0 notes, 19 Nov |
| Accessibility loss detected and shown | n/a | done (session ended, unattended off, notice shown, 19 Nov) | M0 notes, 19 Nov |
| Lock screen behaviour | not tested | done (session ends on lock, 19 Nov) | M0 notes, 19 Nov |
| Resume after network change | partial | partial (20 s Wi-Fi drop ends the session; no auto-resume, 19 Nov) | M0 notes, 19 Nov |
| File send device to viewer | partial | done (1 MiB, hash match, 19 Nov); resume untested | M0 notes, 19 Nov |
| File send viewer to device | partial (download) | done (3 MiB, hash match, 19 Nov); resume untested | M0 notes, 19 Nov |
| Clipboard device to viewer | done (Windows), done (Pixel) | done | — |
| Clipboard viewer to device | missing (ADR 0021 forbids; approved decision) | missing | needs ADR change |
| Multi-monitor selection | partial | n/a | — |
| Audio output | missing | missing | — |
| Microphone input | missing (approved decision) | missing | needs hardware |
| USB forwarding | missing (approved decision) | missing | needs hardware |
| Printing redirection | partial (code, not tested) | n/a | — |
| Wake-on-LAN and boot-to-online | missing | missing | competitor parity |
| Sign-in screen control | source only | n/a | needs hardware |
| Session recording with consent | missing | missing | competitor parity |
| Chat during a session | partial (handoff baseline) | partial | not tested on devices |
| Session policy per device and per portal | partial (per device) | partial (per device) | — |
| Elevation to protected windows and UAC | missing | n/a | competitor parity |
| Independent sessions and RemoteApp | missing | n/a | needs Windows Pro or Server |

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
- Pixel network drop (19 Nov, 17:58): Wi-Fi turned off over ADB for 20 s during a live control
  session. The session ended (it did not resume), consistent with the backend's 15 s silent-host
  rule; a new connection is needed after the network returns. Passed as a clean teardown;
  automatic resume stays a gap (capability matrix: resume after network change = partial).
- Not testable by the agent alone (19 Nov): control expiry (backend `SESSION_MAX_HOURS` minimum is
  1 hour, default 12; needs a bounded config change or a wait), lock screen and Pixel reboot
  (the phone needs its passcode, which the agent does not have; owner unlocks).
- Surfiena trusted access: in the host window press "More options", then choose "They can view
  and control without asking" (view-only: "They can view without asking"). Still needs the Beacon host window in session 1.
- Acceptance backend: the one-hour expiry is an owner decision.
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

| Blocker | Why | Handling |
| --- | --- | --- |
| Surfiena local click per approval | Product consent model | Trusted access turned on once by the owner (M0). Attended tests keep the click. |
| Input test box does not show | Launcher runs hidden and non-interactive | Fix the launcher in M0. Log startup. |
| One-hour acceptance backend | Runbook safety limit | Owner decision (section 6). |
| RDP and VNC comparison needs Windows Pro | No such machine | Hardware. Comparison rules in section 7. |
| Remote typing target | Settings search row is not editable | Debug-only text field app (owner approval, section 6). |

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
