# Beacon Remote roadmap

Updated November 27, 2026. This is the one current plan. Dated checkpoints, handoffs and earlier plans are in
[roadmap history](roadmap-history.md); do not copy status from there without checking it.

Source and CI do not prove device, boot, privacy or network acceptance. Anything marked "needs a device" is only
done when a real run is recorded in [testing-remaining.md](testing-remaining.md) or the
[completion checklist](completion-checklist.md).

## Where the product stands

| Area                   | State                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hosted baseline        | Attended, trusted and support access, remembered helpers, accounts/MFA/export/deletion, teams, signed updates, installer, two-way files, recording, TURN, backups        |
| Windows host UI        | One tabbed window owns all local UI; the helper is headless (ADR 0059). Merged (#135–#140); the Support tab shows the identity key code (#149)                           |
| Windows boot service   | Installed and verified on the lab laptop: presence while signed out after a reboot                                                                                       |
| Windows sign-in screen | After reboot or sign-out the worker starts, the server offers "Open sign-in", the real sign-in screen streams at 25 fps and a viewer click wakes it to the PIN prompt    |
| Windows installer      | Sandbox install/upgrade/repair/uninstall test (26 checks) passes; a real installed lifecycle is not yet accepted                                                         |
| Web                    | Redesign (#134) merged with responsive/theme/overflow work and browser tests; the key code shows on the More tab and a changed key needs an explicit choice (#153, #154) |
| Android host           | Physical Pixel evidence for pairing, video, touch, typing, unattended connect, files; sheets now scroll and cap their width                                              |
| Agents                 | View-only MCP (#105) is unmerged and unexercised against a live session                                                                                                  |

## Blockers

| Blocker                                                                       | Who unblocks it          | What it holds up                                 |
| ----------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| Each Windows service change needs a UAC approval on the laptop                | Owner at the machine     | Every worker/service test cycle                  |
| Typing a password or PIN through the viewer                                   | Owner (credentials)      | Sign-in screen acceptance                        |
| Unlocked Pixel, and a second real network                                     | Owner                    | Android and network acceptance                   |
| Physical hardware: wired Wake-on-LAN peer, audio by ear, extra monitors, GPUs | Owner                    | Power, audio, display and performance acceptance |
| Production deploy and signing-identity actions                                | Owner, explicit go-ahead | Hosted release of anything below                 |

## Order of work

Each milestone ends with the evidence listed in its exit line. Items marked **solo** can be built and checked
without the owner; **owner** needs the owner present; **device** needs a physical device or network.

### M1. Land and release safely

1. Done November 26-27: the stack and #134 are merged into main, #126 is merged, and the dependency PRs #127-#133 are closed
   in favour of the combined #142.
2. Dependencies: the combined update is merged. `pnpm audit` reports no
   known vulnerabilities on that branch (November 26); rerun it before any release and never waive it. (solo)
3. Build matching signed artifacts and migrations 023–028; choose rollout and rollback images; update docs/deployment
   steps. (solo to prepare, owner go-ahead to deploy)
4. Keep local-only work on pushed branches: a delete on November 26 took the local git history and unpushed branches. (solo)

Built November 26 from the merged stack head `1ecbab23`: the signed sign-in-media installer
`dist/BeaconRemoteSetup-1ecbab23-signin-media.exe` (SHA-256 `98E4DB364060CC3A7E137B9BFE6CE6247E5022522131898D0378EE64E8B4A518`),
its development package and trust folder, signed with Beacon Remote's own certificate. Local only: not installed,
published or deployed, and no device has run it.

Rebuilt a third time November 27 from main `e9e67dc4` (adds acting on semantic targets and the display the tree reports, to
everything in `60048f0f`): the signed sign-in-media installer
`dist/BeaconRemoteSetup-e9e67dc4-signin-media.exe` (SHA-256 `52B187695D65FADEED47F719BDC5504A95A1373190AF48C09A4384E6EF81ED53`),
its development package and trust folder, signed with Beacon Remote's own certificate. Local only: not installed, published or
deployed, and no device has run it. It supersedes `60048f0f` for the M2 laptop run; deploy the web build and protocol first.

Rebuilt again November 27 from main `60048f0f` (adds the semantic-target channels, stricter folder and download names and
the viewer/protocol changes since `a3737240`): the signed sign-in-media installer
`dist/BeaconRemoteSetup-60048f0f-signin-media.exe` (SHA-256 `467F68ADD0D1A4C898BD75EF108DB4965A8CCB74A807572E7846FE45F76DD396`),
its development package and trust folder, signed with Beacon Remote's own certificate. Local only: not installed, published or
deployed, and no device has run it. It supersedes the `a3737240` candidate for the M2 laptop run. A host built from it offers
a `ui_tree` permission, so the web build and protocol must be deployed first (see deployment.md).

Rebuilt November 27 from main `a3737240` (adds clipboard modes and peer authentication): the signed sign-in-media installer
`dist/BeaconRemoteSetup-a3737240-signin-media.exe` (SHA-256 `FC8080B68EC7EEDE34DD6BAF381F65C1A19A4FEBFE3007F0E0BE2E3F32A3E4DA`),
its development package and trust folder, signed with Beacon Remote's own certificate. Local only: not installed,
published or deployed, and no device has run it. It supersedes the `1ecbab23` candidate for the M2 laptop run.

Exit: main contains the stack, CI green on main, signed candidates staged, nothing deployed without sign-off.

### M2. Windows unattended access, accepted on a real laptop

0. Before the secure-attention test the owner sets the machine policy `SoftwareSASGeneration` to 1 (services) as an
   administrator; Beacon never writes it ([signin-authority.md](signin-authority.md)). Without it the viewer correctly
   reports "policy does not allow Ctrl+Alt+Delete". (owner)
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

In source on every surface: a shared protocol (`packages/protocol/src/session-permissions.ts`: control, files, audio,
recording, drive, print), backend arbitration with generations and 30-second timeouts, viewer controls
(`permission-requests.ts`), the Windows sharing card ("More access requested") and the Android live prompt
(`LivePermissionRequest.kt`). Pixel results for the live prompts are recorded; web and backend unit tests pass.

Left: a device run of each scope on Windows (approve, deny, expire, cancel, revoke, one controller, old input
released), the Windows side with the new tabbed window, and refusal paths for drive and print. (device; fixtures solo)

Exit: the permission matrix in testing-remaining recorded for Windows and Android.

### M4. Android dependable host (P0-3)

Permission recovery, unattended lifecycle, rotation and coordinate changes, lock, network flaps, background and
screen-off, upgrade; then outbound files, multi-touch, audio, TV and tablet scope. Review each screen for size,
overflow and large-text behaviour. (solo for code and layout, device for acceptance)

November 27: the emulator lifecycle runner (`ScreenshotAcceptance`: screenshot API, real WebRTC source, bounded frames, pause
and resume, availability shutdown, local revocation, channel loss, lock-screen shutdown) passes on an API 36 emulator.
Still open: the other screens, which need a paired host. The local dev stack can pair an emulator, but it is blocked by a
stale `owner.json` from November 7 that the owner must archive or approve archiving.

Exit: the Android permission matrix and lifecycle units in testing-remaining pass on the Pixel.

### M5. Remote-work fidelity (P1)

In source: folder mapping under its own permission with host-side boundary checks and a Windows folder picker (P1-4),
monitor-layout diffing and reconnect on layout change (P1-6), and a tested sound and mute gate (P1-9). Not accepted on
a device, and clipboard, file workflows, input fidelity, performance and reconnect are open.

Clipboard in both directions with local approval ([ADR 0060](decisions/0060-windows-clipboard-modes.md): built and unit-tested November 26; needs the device checks); file workflows (browse, batch, resume,
conflicts, Android outbound); drive and folder mapping; full input fidelity (layouts, dead keys, AltGr, IME, wheel,
relative mouse, touch and pen); multi-monitor, mixed DPI, hotplug and high refresh; reconnect after reload, network
change, sleep and host restart; adaptive quality and diagnostics; audio. (solo to build, device for acceptance)

Exit: each item has its test unit in testing-remaining recorded, including refusal and revoke cases.

### M6. Experience and responsiveness (cross-cutting)

Windows host window at other DPIs and sizes (checked on the lab laptop), sign-in viewer layout on all viewports (done in
#139), Android screens, and the remaining public, auth and viewer routes at narrow widths, 200% zoom, keyboard and
screen reader. Visible capture, consent and Stop stay obvious on every surface. (solo, owner for screen-reader and
visual judgement)

Checked November 26 on the redesigned stack: the sign-in, workspace, appearance and auth browser suites pass; the
workspace screens pass Chromium's real 200% zoom; the native sharing and "More access requested" cards render cleanly
offline; the Android pairing screen on an emulator at 200% font scale scrolls fully with no clipped control. November 27, on main after the peer-identity and clipboard merges: the workspace suite at Chromium's real 200% page zoom,
the sign-in, appearance, auth and workspace suites all pass. The public and auth routes (sign-in, create account, forgot password, downloads, assist, invitation, recovery and
verification links) have no horizontal overflow at a 320 px viewport in Chromium. Not yet
checked: the other Android screens (they need a paired host), the Windows host window at other DPIs, and screen readers.

Exit: browser matrix tests green; owner sign-off on Windows and Android layouts.

### M7. Agent control and Motive (P1-1, P3-3)

In source, not exposed: a default-deny scope gate, control tool handlers, a viewer-side control sender, a scope tied to
the owner's granted control, and tool registration behind an explicit operator setting. Not done: the live consented
session, emergency Stop acceptance and Motive. Semantic UI targets ([ADR 0064](decisions/0064-semantic-ui-targets-for-agents.md))
are built end to end except a device run: the snapshot core, Windows and Android readers, the `beacon-ui-tree-v1` channels behind
their own live permission, the viewer relay, the MCP `ui_tree` tool and clicking a named target (unit-tested, and the MCP
path ran in the synthetic live journey against a fixture host; no real host or phone has run it). Receipts are built (November 27): every control
command leaves a bounded receipt without its content, a retried key returns the first receipt, and `control_receipts`
lists them; unit-tested only.

Merge and exercise view-only MCP (#105) in a live consented session; then per-device, time and tool scopes,
short-lived revocable credentials, idempotent bounded commands, receipts and emergency Stop; the device run of
semantic UI targets, and Motive integration. A green protocol test is not a working integration. (solo, with a live session at the end)

### M8. Platform, fleet, network and power (P2)

In source: printing (printer discovery, checked RAW submission, job lifecycle, a print permission and channel; never
run against a printer), a default-deny peripheral allow list and forwarding boundary (P2-3), the native-first decision
for independent sessions and a read-only Windows session list (P2-5). The threat model and review brief for the
SYSTEM session-attach service is [ADR 0063](decisions/0063-system-session-attach-threat-model.md) (proposal; builds nothing).

Printing, cameras, USB and microphone redirection (each approved in principle, each needs hardware and its own
consent and revocation rules); a privileged SYSTEM session-attach service (needs its own security review first);
independent sessions and RemoteApp (decide native or gateway); organization roles, policy, scheduled access and audit;
Linux and Raspberry Pi hosting; macOS only with native permissions; direct, relay, IPv6, proxy and offline-LAN modes;
Wake-on-LAN, sleep and update recovery. (design first; hardware where listed)

### M9. Trust and operations (P3-1, P3-2)

Key recovery is [ADR 0062](decisions/0062-computer-key-change-and-recovery.md) (a computer's key never moves; recovery is a
new enrollment; removed and replacement computers say so in the viewer). The backend rate limits were reviewed from
source ([security.md](security.md)) and a test guards against logging secret-like values.

Peer authentication against signaling and the end-to-end threat model ([ADR 0061](decisions/0061-peer-authentication-above-signaling.md), accepted; Windows and Android sign, the viewer checks in advisory mode and a changed key needs an explicit "Trust the new key"; all built and unit-tested, not run on a device), strict-mode setting and recovery, public-trust
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

- Clipboard writing approved in both directions, each gated by local approval; the Windows design is [ADR 0060](decisions/0060-windows-clipboard-modes.md), accepted and built.
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
