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
| Unattended trusted access (no local click) | not enabled | not tested end to end | owner decision pending |
| Visible Pause, Stop and local revoke | done (Stop) | done (Pause, Stop) | earlier runs |
| Remote typing into an editable field | not tested | not reaching a field | Settings search row is not editable; test app needed |
| Control expiry and lease loss | not tested | not tested | — |
| Accessibility loss detected and shown | n/a | not tested (the app shows a notice) | — |
| Lock screen behaviour | not tested | not tested | — |
| Resume after network change | partial | partial | — |
| File send device to viewer | partial | partial | — |
| File send viewer to device | partial (download) | partial | — |
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
