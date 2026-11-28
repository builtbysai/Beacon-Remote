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

Rebuilt a fourth time November 27 from main `62ee23c2` (adds the eight-symbol plain pairing code, the pasted-link fill-in and
the clearer sign-in access wording to everything in `e9e67dc4`): the signed sign-in-media installer
`dist/BeaconRemoteSetup-62ee23c2-signin-media.exe` (SHA-256 `518DCE0D302216E6FDF8C72F3AACB6DAAC6355C896578CC1CD950D81772A1A2C`),
signed with Beacon Remote's own certificate. The laptop (SURFIENA) is paired to a throwaway lab fixture with the `e9e67dc4`
build and its boot and sign-in services running; this newer build is staged there, not installed. Upgrading it needs a
service repair (one UAC), and the sign-in-screen test, which needs a sign-out and the owner's PIN, is still to do.

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

0. Owner decision (November 27): the one-time elevated sign-in setup and Repair let services send Ctrl+Alt+Delete
   (`SoftwareSASGeneration`, services bit only) and uninstall restores the previous value
   ([signin-authority.md](signin-authority.md)). Wake on request uses it to get from the lock-screen picture to the
   password prompt, because Windows ignores injected key presses there.
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
independent sessions and RemoteApp (decide native or gateway); organization roles, policy, scheduled access and audit
([ADR 0065](decisions/0065-organization-roles-policy-and-audit.md), a proposal);
Linux and Raspberry Pi hosting and macOS only with native permissions ([ADR 0066](decisions/0066-hosting-beyond-windows-and-android.md),
a proposal); direct, relay, IPv6, proxy and offline-LAN modes, Wake-on-LAN, sleep and update recovery
([ADR 0067](decisions/0067-connection-modes-and-recovery.md), a proposal). (design first; hardware where listed)

### M9. Trust and operations (P3-1, P3-2)

Key recovery is [ADR 0062](decisions/0062-computer-key-change-and-recovery.md) (a computer's key never moves; recovery is a
new enrollment; removed and replacement computers say so in the viewer). The backend rate limits were reviewed from
source ([security.md](security.md)) and a test guards against logging secret-like values.

Peer authentication against signaling and the end-to-end threat model ([ADR 0061](decisions/0061-peer-authentication-above-signaling.md), accepted; Windows and Android sign, the viewer checks in advisory mode and a changed key needs an explicit "Trust the new key"; all built and unit-tested, not run on a device), strict-mode setting and recovery, public-trust
signing, abuse protection, retired-device rejection and re-enrollment, provider and backup retention, and logs that
never hold credentials, pixels or input. Real account lifecycle, MFA and email delivery. (solo for design and code,
owner for real accounts and signing)

## What other remote-access tools have (review, November 27)

Compared with RDP, VNC servers (TightVNC/UltraVNC/RealVNC), RustDesk, AnyDesk, TeamViewer, BeyondTrust (Bomgar),
MeshCentral and Apache Guacamole from their public documentation, not a measured comparison. Done this round: **wake on
request**, so a viewer reaches a locked computer's password prompt without anyone at the keyboard
([signin-authority.md](signin-authority.md)). Everything below is useful and missing or partial; existing items stay
where they are in M2–M9 and the [parity backlog](rdp-vnc-parity-roadmap.md).

| Order | Feature                                                                 | Who has it                                  | Beacon now                                                                  | Fits under               |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------ |
| 1     | Follow the input desktop (lock picture, UAC, sign-in) in one view       | VNC services, RustDesk, AnyDesk, TeamViewer | Separate sign-in worker and ordinary helper with a handoff; wake on request | M2                       |
| 2     | Send Ctrl+Alt+Del from the viewer                                       | All of them (needs the SAS policy)          | Built; setup now sets the services-only policy (owner decision, Nov 27)     | M2                       |
| 3     | Lock the computer when a session ends (setting)                         | AnyDesk, RustDesk, TeamViewer               | Missing                                                                     | M2 / M9                  |
| 4     | Privacy mode: blank the local screen during unattended work             | AnyDesk, TeamViewer, RustDesk, BeyondTrust  | Missing (backlog note); must keep Stop reachable and never hide sharing     | M8 (design first)        |
| 5     | Block local keyboard and mouse while a controller works                 | AnyDesk, TeamViewer, MeshCentral            | Missing; same rule: local Stop always works                                 | M8 (design first)        |
| 6     | UAC prompts reachable from the viewer                                   | RustDesk/AnyDesk services, BeyondTrust      | Ordinary helper stops at the secure desktop by design (UIPI)                | M2 (sign-in worker path) |
| 7     | Restart into Safe Mode with networking and reconnect                    | AnyDesk, TeamViewer, BeyondTrust            | Restart and reconnect exist; Safe Mode missing                              | M8 power                 |
| 8     | Direct LAN connection and discovery                                     | RustDesk, AnyDesk, TeamViewer, MeshCentral  | ICE prefers direct; no discovery or offline-LAN mode                        | M8 network               |
| 9     | Address book: favourites, tags, saved per-computer settings             | AnyDesk, TeamViewer, RustDesk               | Groups and remembered helpers; no saved connection profiles                 | M6                       |
| 10    | Annotation and pointer on the remote screen                             | TeamViewer, BeyondTrust, AnyDesk            | Chat only                                                                   | M6                       |
| 11    | Switch sides during a support session                                   | TeamViewer, AnyDesk                         | Missing                                                                     | M6                       |
| 12    | Codec choice and 4:4:4 text clarity (H.264/H.265/AV1, VP9)              | RDP, AnyDesk, TeamViewer, RustDesk          | H.264 hardware/software; no 4:4:4 or AV1                                    | M5 performance           |
| 13    | All monitors at once and monitor switching in the toolbar               | All of them                                 | One display at a time with selection                                        | M5 displays              |
| 14    | Credential injection from a vault (no password shown to the technician) | BeyondTrust                                 | Missing; the owner types credentials themselves                             | M9 (design first)        |
| 15    | Clientless gateway to existing RDP/VNC/SSH hosts                        | Apache Guacamole                            | Not planned; would be its own authenticated gateway                         | M8 (decide)              |
| 16    | Self-hosted server and relay in one package                             | RustDesk, MeshCentral                       | Self-hosting docs exist; no one-step package                                | M9 operations            |

Deliberately not copied: silent access without a visible indicator, hidden sessions, a general remote terminal or
command surface, and anything that types or stores Windows passwords for the owner.

## Experience review findings (November 27)

From the independent experience/design review in `D:/Dev/scratch/beacon-remote-review-2026-11-27/` (handoff file and
evidence there, outside the repository). Each finding below was checked against the current code on November 27;
"Verified" means the cited code path matches the description. The owner's standard for this work: **after the one-time
setup, trusted unattended access shows a live picture at every step (lock screen, password prompt, desktop), never a
black screen, an unexplained disconnection or an unnecessary prompt.**

| ID  | Pri | Finding                                                                                          | Check                                                                                                                                                                                                                                                                                              | Status                                                                                                                                            |
| --- | --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | P0  | Real sign-in video stayed black although the transport connected                                 | Reproduced on Surfiena with inbound stats: two causes, neither the decoder. The lab cable rule pointed at an old agent path (each Repair makes a new folder), so media used a throttled tunnel; and the app-wide rate limit (120/min) was exhausted by the sign-in service's once-a-second polling | Fixed: per-route budget for machine polling (backend), lab rule re-applied on every deploy. Live: 24 fps, 0 loss, past the 10 s and renewal marks |
| —   | P0  | Black screen while the sign-in view waits for the desktop ("Checking for a desktop handoff…")    | Seen on Surfiena after signing in                                                                                                                                                                                                                                                                  | Partly: last picture kept as poster (no black stage); one continuous view still open                                                              |
| R02 | P1  | Connect still exposes the desktop/sign-in split (separate Open sign-in row)                      | Verified (inspector)                                                                                                                                                                                                                                                                               | Fixed Nov 28: one Connect chooses desktop or sign-in; shows for locked/signed-out trusted computers                                               |
| R03 | P1  | Status mixes presence, permission and readiness ("Windows sign-in · Unavailable" when signed in) | Verified; also `docs/ui-issues.md` 1                                                                                                                                                                                                                                                               | Fixed Nov 28: sign-in row hidden while signed in; "Not reachable right now"                                                                       |
| R04 | P1  | Recovery needs a truthful terminal explanation                                                   | Source matches; regression to verify                                                                                                                                                                                                                                                               | Verified in source: bounded window, a refusal ends recovery at once                                                                               |
| R05 | P1  | Escape never reaches the remote computer (`remote-input.ts` releases input and blurs instead)    | Verified (`remote-input.ts` key handler)                                                                                                                                                                                                                                                           | Fixed Nov 28: plain Escape goes remote; Shift+Escape releases                                                                                     |
| R06 | P1  | Peer-proof failure policy: a failed or changed proof only warns unless strict mode is on         | Source matches; needs a security review before changing admission                                                                                                                                                                                                                                  | Proposal written: [peer-proof-admission-review.md](peer-proof-admission-review.md); needs a security review before admission changes              |
| R07 | P1  | Pairing shows several methods at equal weight                                                    | Verified (web pairing panel)                                                                                                                                                                                                                                                                       | Fixed Nov 28: code first; other methods under "Other ways to pair"                                                                                |
| R08 | P2  | Pairing timer bar drawn against 900 s while codes live 300 s                                     | Verified (`PairComputer.tsx` `seconds / 900`)                                                                                                                                                                                                                                                      | Fixed Nov 27                                                                                                                                      |
| R09 | P1  | Pairing origin and permission review differ by entry path (scan pairs at once, link waits)       | Source matches (Android)                                                                                                                                                                                                                                                                           | Open (M4)                                                                                                                                         |
| —   | P1  | Windows does not handle `beaconremote://pair` links; the web's "Open link" does nothing there    | Verified: no protocol registration; the host only parses a pasted link                                                                                                                                                                                                                             | Fixed Nov 28: per-user protocol, prefill, one Pair click                                                                                          |
| —   | P1  | A standard Windows account cannot finish unattended setup (needs an administrator's password)    | Seen with the BeaconTest account                                                                                                                                                                                                                                                                   | Partly: `unattended-finish` lets an administrator install the services and the user finish                                                        |
| R10 | P1  | Native setup fields have wrong or missing accessible names                                       | Verified (labels created before edits in `host_window.rs`)                                                                                                                                                                                                                                         | Fixed Nov 27                                                                                                                                      |
| R11 | P2  | Windows setup leads with the server URL most people never change                                 | Verified                                                                                                                                                                                                                                                                                           | Partly: pairing links fill in the server; moving the field under Advanced is open                                                                 |
| R12 | P1  | Access and Unattended overlap; setup heading stays stale after pairing                           | Verified; `docs/ui-issues.md` 7                                                                                                                                                                                                                                                                    | Fixed Nov 28                                                                                                                                      |
| R13 | P1  | App updates need a separate Repair approval for the sign-in service                              | Verified; `docs/ui-issues.md` 9                                                                                                                                                                                                                                                                    | Partly: the one approval is brought forward right after an update; folding it into the update is open                                             |
| R14 | P1  | Android copy contradicts behaviour (unlock, system audio, approval card)                         | Source matches                                                                                                                                                                                                                                                                                     | Done on branch android/character-identity (not merged)                                                                                            |
| R15 | P2  | Android guided setup completion model                                                            | Source matches                                                                                                                                                                                                                                                                                     | Done on branch android/character-identity (not merged)                                                                                            |
| R16 | P2  | Long names and oversized headings consume task space                                             | Observed in review fixtures                                                                                                                                                                                                                                                                        | Fixed Nov 28 (web: two/three-line names with tooltips); Android done on its branch                                                                |
| R17 | P2  | Continuous decorative motion in work screens                                                     | Source matches                                                                                                                                                                                                                                                                                     | Fixed Nov 28                                                                                                                                      |
| R18 | P1  | Phone details sheet looks modal but keyboard focus escapes                                       | Review trace; source has no focus boundary on the sheet                                                                                                                                                                                                                                            | Fixed Nov 28: modal sheet with inert background on narrow screens                                                                                 |
| R19 | P2  | Same task named differently across platforms                                                     | Observed                                                                                                                                                                                                                                                                                           | Partly: details say Connect like the list; filters read Active/Online/Offline/Revoked                                                             |
| R20 | P2  | Downloads puts hash verification in the default path; copy failure silent                        | Source matches                                                                                                                                                                                                                                                                                     | Fixed Nov 28                                                                                                                                      |
| R21 | P2  | Support onboarding: competing explanations; every preview error reads as expired                 | Source matches                                                                                                                                                                                                                                                                                     | Fixed Nov 28: preview network failures retry                                                                                                      |
| R22 | P2  | Capability requests separated from the task that needs them                                      | Source matches                                                                                                                                                                                                                                                                                     | Fixed Nov 28 for files (Send file asks for itself); other tasks open                                                                              |
| R23 | P2  | Clipboard and harmless viewer preferences not remembered                                         | Source matches                                                                                                                                                                                                                                                                                     | Fixed Nov 28: scale and touch mode per computer                                                                                                   |
| R24 | P1  | Input fidelity needs an acceptance matrix                                                        | Modifier sync from event flags confirmed working on Surfiena (password typed through the sign-in view)                                                                                                                                                                                             | Open (M5 acceptance)                                                                                                                              |
| R25 | P2  | File picker lacks `multiple`; interrupted batch drops the rest                                   | Verified (`LiveView.tsx`)                                                                                                                                                                                                                                                                          | Fixed Nov 27                                                                                                                                      |
| R26 | P2  | Phone viewer: small desktop details hard to reach                                                | Observed                                                                                                                                                                                                                                                                                           | Partly: scale remembered; pinch zoom open (needs a phone)                                                                                         |
| R27 | P2  | Diagnostics should lead with an answer                                                           | Source matches                                                                                                                                                                                                                                                                                     | Fixed Nov 28: plain answer before counters                                                                                                        |
| R28 | P2  | Entry config errors silently hide sign-up and recovery                                           | Verified (`AccountEntry.tsx` swallows the error)                                                                                                                                                                                                                                                   | Fixed Nov 27                                                                                                                                      |
| R29 | P1  | A failed helper-list load looks like an empty list                                               | Verified (`SupportAccess.tsx` `setList([])` on error)                                                                                                                                                                                                                                              | Fixed Nov 27                                                                                                                                      |
| R30 | P2  | Session history goes stale until Refresh                                                         | Verified (no polling or visibility refresh)                                                                                                                                                                                                                                                        | Fixed Nov 27                                                                                                                                      |
| R31 | P2  | Unknown audit events show their raw names                                                        | Verified (`activityLabel` default returns the action)                                                                                                                                                                                                                                              | Fixed Nov 27                                                                                                                                      |
| R32 | P1  | Windows window shrinks a fixed layout instead of reflowing                                       | Source matches                                                                                                                                                                                                                                                                                     | Open                                                                                                                                              |
| R33 | P2  | Android touch targets and semantics; clipping at 200 % font                                      | Observed                                                                                                                                                                                                                                                                                           | Done on branch android/character-identity (not merged)                                                                                            |
| R34 | P1  | Conflicting status documents and outdated fixtures                                               | Observed                                                                                                                                                                                                                                                                                           | Open                                                                                                                                              |
| R35 | P1  | TURN over TCP/TLS unsupported, limiting restrictive networks                                     | Verified (`config.ts`)                                                                                                                                                                                                                                                                             | Open (M8)                                                                                                                                         |
| R36 | P2  | Platform scope should be clear before installation                                               | Observed                                                                                                                                                                                                                                                                                           | Fixed Nov 28: Downloads says what can be reached                                                                                                  |

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
