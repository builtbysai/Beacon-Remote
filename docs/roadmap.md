# Beacon Remote roadmap

Updated November 26, 2026. This is the one current plan. Dated checkpoints, handoffs and earlier plans are in
[roadmap history](roadmap-history.md); do not copy status from there without checking it.

Source and CI do not prove device, boot, privacy or network acceptance. Anything marked "needs a device" is only
done when a real run is recorded in [testing-remaining.md](testing-remaining.md) or the
[completion checklist](completion-checklist.md).

## Where the product stands

| Area                   | State                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted baseline        | Attended, trusted and support access, remembered helpers, accounts/MFA/export/deletion, teams, signed updates, installer, two-way files, recording, TURN, backups     |
| Windows host UI        | One tabbed window owns all local UI; the helper is headless (ADR 0059). Stacked PRs #135–#140 hold it                                                                 |
| Windows boot service   | Installed and verified on the lab laptop: presence while signed out after a reboot                                                                                    |
| Windows sign-in screen | After reboot or sign-out the worker starts, the server offers "Open sign-in", the real sign-in screen streams at 25 fps and a viewer click wakes it to the PIN prompt |
| Windows installer      | Sandbox install/upgrade/repair/uninstall test (26 checks) passes; a real installed lifecycle is not yet accepted                                                      |
| Web                    | Redesign (#134) and responsive/theme/overflow work, with browser tests; waiting for the review that main requires                                                     |
| Android host           | Physical Pixel evidence for pairing, video, touch, typing, unattended connect, files; sheets now scroll and cap their width                                           |
| Agents                 | View-only MCP (#105) is unmerged and unexercised against a live session                                                                                               |

## Blockers

| Blocker                                                                       | Who unblocks it          | What it holds up                                              |
| ----------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| #134 needs an approving review before it can merge into main                  | Owner (GitHub)           | Everything stacked on it; any hosted release                  |
| Each Windows service change needs a UAC approval on the laptop                | Owner at the machine     | Every worker/service test cycle                               |
| Typing a password or PIN through the viewer                                   | Owner (credentials)      | Sign-in screen acceptance                                     |
| Unlocked Pixel, and a second real network                                     | Owner                    | Android and network acceptance                                |
| Physical hardware: wired Wake-on-LAN peer, audio by ear, extra monitors, GPUs | Owner                    | Power, audio, display and performance acceptance              |
| Dependency audit: high picomatch advisory GHSA-fc5q-39xc-vjpf                 | Upstream/reviewer        | Release; CI's security job passes now, recheck before release |
| Production deploy and signing-identity actions                                | Owner, explicit go-ahead | Hosted release of anything below                              |

## Order of work

Each milestone ends with the evidence listed in its exit line. Items marked **solo** can be built and checked
without the owner; **owner** needs the owner present; **device** needs a physical device or network.

### M1. Land and release safely

1. Merge the stack: #139 and #140 into the #134 branch, then #134 into main once approved. (owner approves)
2. Reconcile and review the open dependency PRs (#127–#133) and #126 (startup, pairing, Android consent) against the
   new stack; recheck the picomatch advisory; never waive the audit. (solo)
3. Build matching signed artifacts and migrations 023–028; choose rollout and rollback images; update docs/deployment
   steps. (solo to prepare, owner go-ahead to deploy)
4. Fix the line-ending noise in four tracked files and keep local-only work in pushed branches. (solo)

Exit: main contains the stack, CI green on main, signed candidates staged, nothing deployed without sign-off.

### M2. Windows unattended access, accepted on a real laptop

1. Sign-in screen: type the PIN or password through the viewer (owner types it); secure attention (Ctrl+Alt+Delete);
   wake the lock screen without a click; Stop, Disable and input release on the sign-in desktop. (owner, device)
2. Restart recovery: restart or fast-restart from the viewer, the fresh-policy reconnect and the hand-off to the user
   desktop; cancelling the restart. (owner, device)
3. Boot presence: cold boot, signed-out and locked states, service recovery after a crash. (device)
4. Installer and service lifecycle on the real machine: clean install, repair, upgrade, rollback, binary drift,
   disable while offline, cancelled admin step, uninstall and re-enroll. (owner approves UAC, device)
5. Normal signed-in control: signed fixture, local approval, moving video, typing/pointer/shortcuts, held modifier and
   button release on Stop, disconnect and expiry, no helper consoles or blinking. (device)
6. Fewer approvals per cycle: batch worker changes; keep installs signed and in the protected Program Files path. (solo)

Exit: [signin-authority.md](signin-authority.md) "Not yet accepted" list is empty and recorded in testing-remaining.

### M3. In-session permission requests (P0-4)

From a view-only session, request control, files, audio or recording. Fresh local approval for broader access, one
controller at a time, old input released, timeouts, never expanding a grant silently; Windows and Android hosts, web
viewer, backend policy. (solo to build and test with fixtures; device to accept)

Exit: browser, backend and native tests for approve/deny/timeout/revoke, then one device run each.

### M4. Android dependable host (P0-3)

Permission recovery, unattended lifecycle, rotation and coordinate changes, lock, network flaps, background and
screen-off, upgrade; then outbound files, multi-touch, audio, TV and tablet scope. Review each screen for size,
overflow and large-text behaviour. (solo for code and layout, device for acceptance)

Exit: the Android permission matrix and lifecycle units in testing-remaining pass on the Pixel.

### M5. Remote-work fidelity (P1)

Clipboard in both directions with local approval (revise ADR 0021 first); file workflows (browse, batch, resume,
conflicts, Android outbound); drive and folder mapping; full input fidelity (layouts, dead keys, AltGr, IME, wheel,
relative mouse, touch and pen); multi-monitor, mixed DPI, hotplug and high refresh; reconnect after reload, network
change, sleep and host restart; adaptive quality and diagnostics; audio. (solo to build, device for acceptance)

Exit: each item has its test unit in testing-remaining recorded, including refusal and revoke cases.

### M6. Experience and responsiveness (cross-cutting)

Windows host window at other DPIs and sizes (checked on the lab laptop), sign-in viewer layout on all viewports (done in
#139), Android screens, and the remaining public, auth and viewer routes at narrow widths, 200% zoom, keyboard and
screen reader. Visible capture, consent and Stop stay obvious on every surface. (solo, owner for screen-reader and
visual judgement)

Exit: browser matrix tests green; owner sign-off on Windows and Android layouts.

### M7. Agent control and Motive (P1-1, P3-3)

Merge and exercise view-only MCP (#105) in a live consented session; then per-device, time and tool scopes,
short-lived revocable credentials, idempotent bounded commands, receipts and emergency Stop; semantic UI targets and
Motive integration. A green protocol test is not a working integration. (solo, with a live session at the end)

### M8. Platform, fleet, network and power (P2)

Printing, cameras, USB and microphone redirection (each approved in principle, each needs hardware and its own
consent and revocation rules); a privileged SYSTEM session-attach service (needs its own security review first);
independent sessions and RemoteApp (decide native or gateway); organization roles, policy, scheduled access and audit;
Linux and Raspberry Pi hosting; macOS only with native permissions; direct, relay, IPv6, proxy and offline-LAN modes;
Wake-on-LAN, sleep and update recovery. (design first; hardware where listed)

### M9. Trust and operations (P3-1, P3-2)

Peer authentication against signaling, an explicit end-to-end threat model, key change and recovery, public-trust
signing, abuse protection, retired-device rejection and re-enrollment, provider and backup retention, and logs that
never hold credentials, pixels or input. Real account lifecycle, MFA and email delivery. (solo for design and code,
owner for real accounts and signing)

## Suggested goals

Pick one as the next goal; each is self-contained and has an end state.

| Goal                                   | Milestones | Needs the owner for                |
| -------------------------------------- | ---------- | ---------------------------------- |
| Windows sign-in accepted on the laptop | M2         | PIN typing, UAC approvals, reboots |
| Release candidate on main              | M1         | Review approval, deploy go-ahead   |
| Permission requests built and tested   | M3         | A device run at the end            |
| Android host acceptance                | M4         | The unlocked Pixel                 |
| Agents on a live session               | M7         | One live consented run             |

## Decisions already made

- Clipboard writing approved in both directions, each gated by local approval; ADR 0021 must be revised before code.
- A privileged SYSTEM service for native session attach is approved, subject to its own security review.
- USB forwarding and microphone redirection are approved, each with its own consent and revocation rules.
- Native downloads and update feeds advance only after the matching signed candidates pass physical acceptance.
- No server media storage and no terminal or general privileged-command surface.

## Working boundaries

Keep visible sharing, single-controller authority, local revoke, short leases, the unattended idle limit, fresh-policy
reconnect and protected-content handling. Never bypass Windows credentials, secure desktop rules, Android lock/PIN or
protected content. Keep View on the shared VM, independent databases and dedicated relay ownership. Read
[security.md](security.md), [architecture.md](architecture.md) and [workspace.md](workspace.md) before implementation.
Do not repeat the completed account reset or credential rotation. Source work, CI and healthy endpoints do not
authorize a deployment or an install, reboot or UAC action on any machine; the owner approves those.

## Sources of truth

[completion checklist](completion-checklist.md) (evidence and receipts) · [testing remaining](testing-remaining.md)
(next test units) · [RDP/VNC parity plan](rdp-vnc-parity-roadmap.md) (detailed backlog P0–P3) ·
[development status](development-status.md) (last verified checkpoints) · [sign-in authority](signin-authority.md) ·
[windows agent](windows-agent.md) · [owner actions](owner-actions.md) · [roadmap history](roadmap-history.md)
