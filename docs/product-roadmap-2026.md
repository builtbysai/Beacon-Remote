# Beacon Remote product roadmap (2026)

This roadmap replaces the ordered backlog in [rdp-vnc-parity-roadmap.md](rdp-vnc-parity-roadmap.md)
as the planning document. That file keeps the detailed capability notes and the
evidence trail. Test results stay in [testing-remaining.md](testing-remaining.md).

## Goal

Beacon Remote is a browser-first remote access product for people who need to reach
their own computers and Android phones, and for support teams that need to reach
computers they manage. Done means:

1. **Unattended trusted access** to the owner's own Windows and Android devices,
   from a browser, with no local click per session when the owner has chosen trusted
   access on that device, and an immediate local Stop and revoke on the device.
2. **Attended support** with explicit local approval, visible Pause/Stop, and the same
   consent model for view, control, files, clipboard, printing, audio and recording.
3. **Daily-use parity** with RDP, VNC and mainstream support tools for the everyday
   tasks: control, clipboard, files, multi-monitor, audio, reconnect, performance.
4. **Operator features** for teams: accounts with MFA, access policy, audit,
   session ownership, fleet inventory and a supportable release process.

We do not claim to be better than another product until a published, repeatable
measurement shows it on a named task. See the comparison rules in section 6.

## 1. Competitive baseline

Sources are vendor pages and review sites. The unattended and clipboard claims are
the vendors' own statements unless noted, and need checking against current documentation
before any product decision.

- **Microsoft RDP:** file and clipboard redirection between local and remote machines,
  multi-monitor layouts and saved connections ([Helpwire](https://www.helpwire.app/blog/microsoft-remote-desktop-vs-vnc/),
  [ZipDo](https://zipdo.co/best/remote-access-desktop-software/)). Needs a reachable Windows
  host; RDP is not available on Windows Home (Microsoft product documentation, from our own testing notes).
- **RealVNC:** two-way file transfer and multi-monitor support, and a managed-device
  tier for unattended access ([RealVNC guide](https://www.realvnc.com/en/blog/best-remote-access-software-for-windows/),
  [G2 comparison](https://www.g2.com/compare/realvnc-vs-remotepc-vs-anydesk)).
- **TeamViewer:** unattended access, file transfer, clipboard sync and chat; vendor
  claims a single license covers unattended access ([TeamViewer comparison](https://www.teamviewer.com/ams/special/teamviewer-vs-beyondtrust/)).
- **AnyDesk:** clipboard redirection, keyboard mapping and multi-monitor span; file
  transfer tied to an active session ([ZipDo](https://zipdo.co/best/remote-access-desktop-software/),
  [G2](https://www.g2.com/compare/anydesk-vs-realvnc-vs-remotepc)).
- **BeyondTrust Remote Support (formerly Bomgar):** session policies with explicit
  view and control grants, controller identity and access history, and support-team
  workflows ([BeyondTrust](https://www.beyondtrust.com/products/remote-support/features/session-policies),
  [Splashtop comparison](https://www.splashtop.com/blog/programs-like-beyondtrust-remote-support)).
- **Splashtop, ConnectWise ScreenConnect:** support-team and unattended access, with
  reporting and multi-user administration ([G2 comparison](https://www.g2.com/compare/beyondtrust-remote-support-vs-screenconnect-vs-splashtop-remote-access)).

What Beacon can credibly offer that the list above does not emphasize:
- No client install: the viewer is a web page.
- Local approval and visible Stop by design, with separate grants for files, printing and recording.
- Android phones as hosts, with local approval and Pause/Stop.
- A single, inspectable permission model in the browser.

Where Beacon is behind today: unattended Windows at sign-in, file workflows, clipboard,
multi-monitor, audio, printing, reconnect, performance, fleet administration, and
independent Windows sessions.

## 2. Capability matrix

Status: **done** means implemented and tested on real hardware; **partial** means
implemented with known gaps; **missing** means not built. "Hardware" items need a
device in hand.

| Capability | Windows | Android | Status |
| --- | --- | --- | --- |
| Attended view with local approval | Yes | Yes | done (device-tested) |
| Attended control with local approval | Yes | Yes | partial (Pixel control passes; Surfiena control blocked on test box) |
| Unattended trusted access (no local click per session) | Not tested | Pixel: enabled by owner, not yet tested end to end | partial |
| Visible Pause and Stop, local revoke | Yes | Yes | done (Pixel Pause and Stop tested) |
| File send from device to viewer | Yes | Yes | partial |
| File send from viewer to device | Yes (download) | Partial | partial |
| Clipboard: device to viewer | Yes | Yes | done (Windows and Pixel) |
| Clipboard: viewer to device | Not built | Not built | missing (ADR 0021 forbids; decision approved) |
| Remote typing (viewer to device) | Partial | Not reaching a field yet | partial |
| Multi-monitor selection | Partial | n/a | partial |
| Audio output | Not built | Not built | missing |
| Microphone redirection | Not built | Not built | missing (approved decision) |
| USB redirection | Not built | Not built | missing (approved decision) |
| Printing redirection | Partial (code, not tested on device) | n/a | partial |
| Reconnect after network change | Partial | Partial | partial |
| Session recording | Not built | Not built | missing |
| Windows sign-in screen control | Source only | n/a | missing (hardware) |
| Independent user sessions (RemoteApp, multiple users) | Not built | n/a | missing |

## 3. Milestones

Work the milestones in order. Each one has an exit gate that must be met with
evidence in [testing-remaining.md](testing-remaining.md) before the next one starts.

### M0. Environment without blockers (now)

Exit gate: both devices can run the next test with no owner click except the
explicit consent the product requires.

- Pixel: unattended access turned on for the owner's account; accessibility and
  restricted settings allowed; screen timeout 30 minutes; a debug-only text field
  screen for remote typing tests (not in release builds).
- Surfiena: trusted access turned on by the owner in the Beacon host window (one click,
  because the device-side policy change is made on the device); the input test window
  starts visibly in the signed-in session from one command.
- Acceptance backend: a bounded but reusable test backend (the one-hour expiry in the
  current runbook slows every run). Changing the expiry is an owner decision.
- One runbook: the owner's one-time steps and every run's command in one file.

### M1. Unattended trusted access (Windows and Android)

Exit gate: with trusted access on, the owner opens a machine from the browser and gets
video and control with no local click; Stop and revoke on the device end the session at once;
audit shows who connected and when.

- Windows: trusted access survives reboot and sign-in; the host starts in the
  signed-in session; standing permission is checked against the server policy each session.
- Android: unattended control works after a Pixel reboot; accessibility loss is detected and shown.
- Both: expiry and revoke tests; control expiry; lock screen behavior; resume after a dropped network.
- Sign-in screen control on Windows (source exists; needs hardware) stays a separate gate.

### M2. Daily-use features (parity with RDP and VNC)

Exit gate: each feature passes a scripted task on both platforms, with timings.

- Remote typing and shortcuts on both platforms, including the Settings search field and the Surfiena test window.
- File transfer both directions with resume and integrity checks.
- Clipboard viewer-to-device: first a plain-text path behind a device approval, then rich formats.
- Multi-monitor selection and layout changes; resize; DPI.
- Audio output; then microphone (approved decision, with its own consent).
- Printing on Windows.
- Session recording with consent.

### M3. Reliability and performance

Exit gate: measured latency, frame rate and reconnect time against a published task list.

- Pause, Stop and reconnect under packet loss and network change.
- Frame-rate and latency measurement with a fixed test pattern.
- Clear error reasons on the device and in the browser.

### M4. Team operator features (Bomgar-style support)

Exit gate: an admin can set policy for a group, see every session, and export the audit log.

- Accounts with MFA and single sign-on; roles; per-machine policy; session ownership.
- Audit export and retention.
- Fleet inventory with device health.

### M5. Platform reach

- Windows Pro/Enterprise/Server test host for the RDP and VNC comparison (hardware).
- Linux and macOS hosts (not started).
- Native Windows session attach for a session without a logged-in console user: only after a security review of a SYSTEM service (approved decision; review first).

### M6. Automation and handoff

- Scoped automation credentials for an AI agent, with a view-only MCP adapter already in source.
- Semantic UI trees and computer-use input, with the same consent model.

## 4. Known blockers and how this roadmap handles them

| Blocker | Why | Handling |
| --- | --- | --- |
| Surfiena local click for each approval | Product consent model; fixture forbids clicking consent | Owner turns on trusted access once (M0); per-session approvals stay for attended tests |
| Probe window does not show | Launcher runs hidden and non-interactive | Fix the launcher in M0 and log its startup |
| One-hour acceptance backend | Safety runbook | Owner decision in M0 |
| RDP/VNC comparison needs Windows Pro | No such machine | Hardware; comparison rules in section 6 |
| Sign-in screen and USB | Needs hardware and driver work | Separate gates in M1 and M5 |

## 5. Owner decisions needed

1. Turn on trusted access on Surfiena for the test account (device-side click).
2. Whether the acceptance backend may stay up longer than one hour.
3. Approve the debug-only text field app for Pixel remote-typing tests.
4. Clipboard viewer-to-device: confirm the ADR 0021 change to permit it with device approval.
5. Whether a SYSTEM service for native session attach can be reviewed now or after M2.

## 6. Comparison rules

Beacon may state "better than" for a named task only after:
- the same two machines, network and task list are used for each product;
- at least five runs per product, with median and spread;
- raw numbers and build versions are published with the claim.

Until then the claim is "measured" or "different by design", never "better".

## 7. Working rules

- Every change ships with the smallest test that protects the behavior.
- Every device test is recorded in [testing-remaining.md](testing-remaining.md) with the build and hardware used.
- Development checkpoints are committed and pushed to the feature branch;
  deployment to a shared server is a separate, explicit step.
- Destructive actions on devices (wiping accounts, reinstalling) need an owner request.
