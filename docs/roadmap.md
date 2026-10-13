# Beacon Remote delivery roadmap

## Where it stands (2026-10-13)

The product described by ADRs 0021 to 0029 is built, merged to main and deployed at `remote.builtbysai.com` with
sessions, remote control and the dedicated relay enabled. The phases below set priority, not order: work on any
independent item, and when one needs a real device, a certificate or an owner decision, record the blocker and move on.
The section under the line is the earlier milestone record, kept for history; where it conflicts with this one, this one wins.

Each feature is tracked on five facts. **Impl** the code exists. **Integ** it is wired into the product end to end.
**Valid** it was checked on a real device or a real stack, not only by unit tests or CI. **Rel** it is in the deployed
product. **Block** an actual external dependency. A dash means no, a tick means yes. Never mark a box because code exists.

### Phase 1: finish the existing product

| Feature                                                                                                           | Impl | Integ | Valid                                             | Rel | Block / note                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ---- | ----- | ------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------ |
| Access modes: attended, trusted, support codes, remembered helpers (0021, 0023, 0024, 0027)                       | ✓    | ✓     | ✓                                                 | ✓   |                                                                                                                    |
| Open-ended sessions, auto-reconnect, immediate revocation                                                         | ✓    | ✓     | ✓                                                 | ✓   | Interruption matrix on real devices still open                                                                     |
| Remote control: mouse, keyboard, shortcuts, scroll, touch and trackpad, paste and copy                            | ✓    | ✓     | ✓                                                 | ✓   |                                                                                                                    |
| Two-step sign-in, recovery codes, operator password recovery (0025, 0026)                                         | ✓    | ✓     | ✓                                                 | ✓   |                                                                                                                    |
| Windows host: pairing, start at sign-in, tray, signed updates with rollback (0022, 0028)                          | ✓    | ✓     | ✓                                                 | ✓   |                                                                                                                    |
| Native consent, sharing and host windows with Pause (0029)                                                        | ✓    | ✓     | ✓                                                 | ✓   |                                                                                                                    |
| Screenshots preserved with a manifest and README (`scripts/shot.mjs`)                                             | ✓    | ✓     | ✓                                                 | ✓   |                                                                                                                    |
| Design: direction and Computers list                                                                              | ✓    | ✓     | ✓                                                 | ✓   | `design/DIRECTION.md`                                                                                              |
| Design: Sessions, inspector header                                                                                | ✓    | ✓     | ✓                                                 | ✓   |                                                                                                                    |
| Design: Assist, Activity, landing, sign-in, settings, downloads, pairing, viewer overlays, tray and host surfaces | –    | –     | –                                                 | –   | Audit and rollout in progress; one screen at a time                                                                |
| Adaptive video quality (five tiers from receiver reports and encode cost)                                         | ✓    | ✓     | loopback: reached 1080p30 at about 0.9 core       | ✓   | Constrained and relay-only links need real devices                                                                 |
| Cursor shape, multi-monitor switching during a session                                                            | –    | –     | –                                                 | –   |                                                                                                                    |
| Double-click Windows installer, uninstall that removes credentials (0030)                                         | ✓    | ✓     | sandboxed profile and the published exe           | ✓   | Unsigned. Apps and features shows no commit in the first published build (fixed after). Graphical wizard not built |
| Authenticode signing                                                                                              | –    | –     | –                                                 | –   | Blocked: needs a code-signing certificate                                                                          |
| Tray flyout and toast for incoming requests                                                                       | –    | –     | –                                                 | –   |                                                                                                                    |
| Public sign-up, email confirmation and password recovery by email (0032)                                          | ✓    | ✓     | backend test and local fixture with a file outbox | –   | Blocked: needs a Remote Resend key and sender (RESEND_API_KEY, MAIL_FROM, PUBLIC_SIGNUP=true). Ships closed        |
| Account data export and deletion                                                                                  | ✓    | ✓     | local fixture                                     | ✓   | Needs password (and code) again                                                                                    |
| Abuse limits beyond per-route rate limits                                                                         | –    | –     | –                                                 | –   |                                                                                                                    |
| Account data export and deletion                                                                                  | ✓    | ✓     | local fixture                                     | ✓   | Needs password (and code) again                                                                                    |
| Abuse limits beyond per-route rate limits                                                                         | –    | –     | –                                                 | –   |                                                                                                                    |
| Accountless guest support (migration 012)                                                                         | ✓    | ✓     | backend test; UI error path                       | ✓   | Not yet run end to end with a real code on a real device                                                           |
| Accessibility and reduced-motion audit of the Remote web app                                                      | ✓    | ✓     | axe-core: zero violations, light, dark and 375 px | ✓   | Screen-reader pass by hand not done                                                                                |
| Relay quota alerting, restore drills, latency observability                                                       | –    | –     | –                                                 | –   |                                                                                                                    |
| Real-device acceptance: sustained load, Wi-Fi to mobile data, sleep and resume, relay-only, lock/UAC              | –    | –     | –                                                 | –   | Blocked: needs the owner's devices                                                                                 |

### Phase 2: complete remote support

| Feature                                                                                                            | Impl | Integ | Valid                                                            | Rel | Block / note                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ---- | ----- | ---------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| File transfer to the computer: choose or drop, progress, cancel, checksum, saved in Downloads\Beacon Remote (0031) | ✓    | ✓     | loopback: 3 MB, name sanitized, hash and Mark of the Web checked | –   | Only for attended sessions where the person ticked the box. Trusted-policy sessions, receiving from the computer and resume not built |
| Session recording: optional, clearly indicated, encrypted, retention, playback, download                           | –    | –     | –                                                                | –   | Never covert; per-session consent                                                                                                     |
| Technician accounts and support workflows                                                                          | –    | –     | –                                                                | –   |                                                                                                                                       |
| Remote audio, Wake-on-LAN, connection quality indicator, session diagnostics                                       | –    | –     | –                                                                | –   | Only where it removes a real workflow gap                                                                                             |

### Phase 3: cross-platform expansion

A shared protocol and backend, built up progressively. Beacon View's credentials, permissions and databases stay separate.

| Feature                                                                   | Impl | Integ | Valid | Rel | Block / note                                         |
| ------------------------------------------------------------------------- | ---- | ----- | ----- | --- | ---------------------------------------------------- |
| Controller: any modern desktop browser                                    | ✓    | ✓     | ✓     | ✓   | Chrome verified; Safari, Firefox, Chromebook not yet |
| Controller: Android phone and tablet (web)                                | ✓    | ✓     | ✓     | ✓   | Native Android controller not started                |
| Controller: iPhone and iPad                                               | –    | –     | –     | –   | Web first; iOS cannot promise unrestricted control   |
| Host: Android (MediaProjection, AccessibilityService, foreground service) | –    | –     | –     | –   | Priority after Windows is reliable                   |
| Host: macOS, Linux (X11 and Wayland), Raspberry Pi, Android TV            | –    | –     | –     | –   |                                                      |

### Phase 4: advanced capabilities

| Feature                                                                    | Impl | Integ | Valid | Rel | Block / note                                                                    |
| -------------------------------------------------------------------------- | ---- | ----- | ----- | --- | ------------------------------------------------------------------------------- |
| Groups, roles, permission policies, audit history, organization management | –    | –     | –     | –   |                                                                                 |
| Optional self-hosted deployment                                            | –    | –     | –     | –   |                                                                                 |
| MCP and computer-use integration over the existing view and input core     | –    | –     | –     | –   | Explicit authorization, bounded capability, visible state, immediate revocation |
| Further performance work from measured bottlenecks                         | –    | –     | –     | –   |                                                                                 |

---

## Earlier milestone record

Updated 2026-10-12 after the public-source security review, restored hosted CI
and attended-consent lifecycle work. Earlier PR #8/#9 media, interface, relay
and owner mobile-data evidence remains recorded below. See
[Claude handoff](CLAUDE_HANDOFF.md).

Latest owner acceptance: the PR #25 native pair passed the guided real-device
Decline/Escape, pending cancellation/re-request, manual desktop viewing and local
Stop sequence, plus keyboard Stop. An updated bounded fixture subsequently passed
owner-confirmed sign-in and automatic expiry: video ended and the Windows Stop
window closed after two minutes. The owner also confirmed Windows lock ended
viewing and reconnecting required a fresh session. Pending-prompt lock/expiry,
route/performance and updated UI acceptance still remain; media release acceptance remains open. See [the consent validation](consent-validation-2026-10-12.md).

The viewer recovery follow-up aligns browser peer-loss handling with the native
helper: allow a brief disconnected state to recover on the same approved peer;
failed/closed peers and sustained loss still end the request. Playback
results are scoped to the original session lifetime so a late manual Play result
cannot replace an ended status. Actual device/network interruption acceptance
remains required; these guards do not complete milestone 4.

The owner then tested refresh: it disconnected, but they explicitly requested
that a reload keep an active authorization. The reload follow-up preserves the
original login/approval/deadline through a short transport-recovery window with
capture stopped while absent. Stop/lock/logout/revoke/restart still end access.
The owner confirmed video returned after refresh on the matching fixture, but
reported noticeable delay and a failed later connection. Reliability acceptance
has not passed. Renewal now continues independently of media rebuild/cleanup,
the recovered peer clears its disconnect timer, and cleanup runs concurrently.
Matching acceptance of this corrective change remains pending. See
[ADR 0015](decisions/0015-active-viewer-reload-recovery.md).

The next owner test again showed an unreliable second connection and roughly
ten-second startup. Native offer setup was 4–12 ms and cleanup 24–41 ms, so the
unmeasured network/ICE/first-frame portion remains the latency target. The viewer
now attempts bounded replacement of a failed peer within the original approval;
candidate pooling prepares browser ICE during the consent wait. Native ICE
stages, error codes and first-packet timings support diagnosis. A sub-second
connection target is not verified, and two-minute attended grants remain in
force. Remembered personal-device authorization still belongs to the explicit
setup in milestones 6–7; it is not inferred from one attended Allow.

Viewer expiry also bounds the initial remaining lifetime with a monotonic clock,
so rolling the system clock backward during a session cannot defer local cleanup.
Server/native leases remain authoritative. Updated real-device automatic expiry
passed; browser sleep/resume acceptance remains open.

Pending viewer requests are also scoped to the original page/sign-in context.
Late responses after navigation or sign-out cannot open a viewer; obsolete
grants get a best-effort Stop attempt. Actual browser/prompt acceptance and the
original expiry fallback remain relevant after authentication or network loss.

The owner requested compact, polished Windows host surfaces with concise copy
and a later one-time trusted-device setup. Current milestone 4 work simplifies
the consent/Stop windows and shows actual remaining grant time. Full approved
native host design belongs with milestone 6 and the ongoing UX track. Plan an
explicit owner setup choice for remembered personal devices, durable device
authorization and revocation in milestones 6–7; keep guest support attended and
view/control scopes separate. Do not reuse attended approval or a browser cookie
as permanent desktop permission. The owner also requested recovery after restart
and unlock in that remembered mode. See [the access-mode decision](decisions/0014-personal-device-access-direction.md).

## Product and architecture

The goal is Windows computer → authenticated browser → responsive desktop
viewing and control. The consumer journey is download, install, pair, see the
computer online, choose Remote, and use mouse/keyboard. Network and codec details
belong in diagnostics, not the normal setup flow. Attended access must clearly
identify the viewer, requested permissions and local Stop control.

React/Vite provides public, account, inventory and session surfaces.
Fastify/PostgreSQL owns account/machine authorization, presence, audit and bounded
signaling. The Rust agent owns Ed25519/DPAPI identity; an interactive Rust helper
owns capture and eventually input through reusable capability interfaces.
WebRTC carries video directly where possible, with Coturn as relay fallback.
Oracle hosts the isolated control plane, not a recording server. Beacon View
remains an independent Android camera product, with separate credentials,
database and permissions even when infrastructure is shared.

## Evidence and current gaps

| Area                     | Working evidence                                                                                                  | Remaining gate                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Foundation               | Backend/web and native Windows builds, including local MSVC checks                                                | Keep required hosted CI green and validate fresh test databases                                |
| Account/machine identity | Private invitations/login, actual pairing, DPAPI persistence, signed presence, restart and revoke                 | Public account lifecycle, MFA/recovery and retention/deletion                                  |
| Capture                  | Actual attended primary-display WGC capture, snapshot interface and measurements                                  | Sustained performance, lock/display-loss behavior, broader hardware                            |
| Media                    | Real native H.264 in Chrome, local Stop; owner confirmed Android/T-Mobile separate-network desktop viewing + Stop | Full interruption/recovery, sustained performance, broader route/hardware acceptance           |
| Approved interface       | Real inventory/inspector/naming, activity/history/browser sessions; responsive/theme checks                       | Complete native host states, permission focus/readability feedback and backend-dependent flows |
| Deployment               | Isolated Oracle control plane, HTTPS, encrypted backup/restore and rollback                                       | Production media/control disabled; input development slice now implemented                     |

October 12 update: the private-alpha control plane and interface were manually
rolled out at exact `74a4e6e4d6573836c3da6dfc766b4c84c90c02e7` after local
control-plane validation, encrypted backup/integrity, isolated restore, and
schema/role verification. Production media remains disabled. See
[October 12 validation](validation-2026-10-12.md). The earlier
`ff452ffe66dd600e9a7b18d12fccc08ac970a7d6` interface release below is
historical.
PR #8 was merged as `d6c40c8`, PR #9 as `6d8d7496` into main. CI was
successful at PR #9 head `0979cd1` (run 38083605846); merged code is **not**
proof of a new deployment or production media approval.
Local follow-up changes are not deployment evidence. A synthetic stream is not
desktop acceptance; a local direct connection is not relay acceptance. Consent
audit proves permission, not that a viewer decoded media.

## Implementation tracks and release gates

Historical milestone numbers identify feature tracks, not sequential implementation
locks. The owner's October 12 instruction authorizes independent implementation
across input, installation, approved UI and accounts/support. Implementation
readiness means a feature can be safely built and tested in isolation. Release
readiness requires its own security, functional and real-device evidence.
Unfinished media acceptance does not block independent input/installer/UI work.
Production media and control remain disabled; no rollout is authorized by a build.

| Milestone                              | Status                                 | Deliverable and completion gate                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Research/architecture              | Foundation recorded                    | Existing capture/encoding/transport decisions remain measured prototypes; refine using evidence                                                                                                                      |
| 1 — Repository foundation              | Implemented                            | Formatting/lint/types/backend regressions and native Windows CI remain green                                                                                                                                         |
| 2 — Identity/presence                  | Private-alpha acceptance passed        | Pair real agent, survive backend restart, expire stale presence and reject revoked identity                                                                                                                          |
| 3 — Capture                            | Initial acceptance passed              | Visible primary-display capture and bounded snapshot path; broader hardening belongs in media/resilience gates                                                                                                       |
| **4 — Attended WebRTC media**          | **Implemented; acceptance continuing** | Authorized direct and forced-relay real Windows/browser viewing, explicit local consent/Stop, safe loss/restart/expiry and measured behavior                                                                         |
| 5 — Authorized input                   | Implemented; development only          | Separate view/control approval, typed DataChannels, one controller, pointer/buttons/drag/scroll/keys/modifiers, held-input release on shutdown, respect UIPI/UAC                                                     |
| 6 — Resilient installation             | Authorized independent track           | Least-privilege service/interactive helper, restricted IPC, visible status/tray, reboot recovery, unsigned development installer, secure update/rollback design and clean uninstall; signing before consumer release |
| 7 — Consumer account/release readiness | Authorized independent track           | Reviewed signup/email verification, MFA/recovery, credential rotation, retention/deletion, abuse limits and complete account/support flows                                                                           |
| 8 — Production UX and reliability      | Authorized independent track           | Complete approved responsive UI, actionable lifecycle errors, accessibility and attended temporary support with distinct view/control approval                                                                       |

Account lifecycle is a general-consumer release gate. It can be reprioritized by
the owner, but unfinished recovery/MFA screens remain honestly unavailable.
Guest support needs scoped authorization, expiration and local approval; it must
never inherit computer access from a camera or a public support code.

## October 12 delivery pass: input and approved inspector

The installation follow-up adds a native per-user pairing/status window and tray,
real signed presence, shared GUI/CLI identity locking, Start/Stop and graceful
helper cancellation through a private anonymous child pipe. Installer v2 opens
the native Host directly. Service/session-0 IPC, logon/reboot startup and signed
updates remain unbuilt. Web appearance now uses one compact System/Light/Dark
picker across public/auth/workspace headers with safe preference persistence.

Implemented behind two explicit development switches: separate `desktop:control`
requests, scope-bound server token, local Allow control and visible Stop,
ordered WebRTC DataChannel, physical primary-display pointer mapping, mouse
buttons/drag/scroll, scan-code keyboard/modifiers, focus/Escape release, bounded
messages and monotonic deadlines. View grants cannot open the native input path.
Control disconnect consumes approval; it never inherits view reload recovery.
The input watchdog releases state on authority loss, local Stop, desktop loss or
missing browser heartbeat. Production configuration rejects the control switch.

Owner-approved local control now delivered actual streamed clicks and a drag
movement to the native test window; browser Stop ended control and the helper
exited. The owner requested removal of the demo cutoff: explicitly enabled
loopback sessions now run until stopped while short authorization renewals remain
mandatory. The connection stayed active past two minutes. Wheel/keyboard and
held-input cleanup acceptance remain open because the same-PC viewer loses focus
when remote clicks activate the target. Cross-network control remains unverified.
Automated scope, exclusivity, audit, cleanup and coordinate regressions are
validation, not full device acceptance. The fixture enrolls a fresh in-memory
identity in a disposable Remote test schema; it uses no owner/production identity.
See [input development](input-development.md) and [ADR 0016](decisions/0016-development-control-slice.md).

Approved UI work adds the device inspector's identity/status, separate Remote and
View only actions, factual access state and real history, plus corrected workspace
proportions and selection. Actual desktop/mobile/tablet rendering was inspected
against the running desktop prototype. Full fidelity, native host design, account
lifecycle, support and installer/service remain ongoing independent tracks.

True release blockers: authorization/consent/Stop/expiry/revocation failures,
held-input cleanup, secure-desktop boundaries, account lifecycle and update trust.
Remaining media acceptance: sustained performance, broader hardware/routes,
interruption/reload reliability and native focus/DPI feedback. Preserve these
checks without repeating investigations absent a new reproduced failure.

## Current milestone 4 implementation sequence

October 11 continuation: PR #11 merged after local validation and the control
plane manually rolled out at 4ea7ad9, with production media still disabled.
The long-poll backend and matching native fixture are installed in isolated
acceptance. Actual synthetic dual-relay playback and backend restart/fresh request
passed; no new desktop acceptance is claimed. Viewer timing/FPS/RTT diagnostics
support remaining real-device measurement. See validation-2026-10-11.md.

October 11 local foundation: Remote now has its own start/stop/status supervisor,
strict API/viewer ports and isolated state; View's active work is preserved.
Historical loose artifacts are recoverably archived with hashes. See
[local-development.md](local-development.md). This is development isolation,
not milestone 6 service installation or production media release. Continue
milestone 4 consent-latency and real-desktop lifecycle acceptance next.

1. **Backend relay foundation — started in this pass.** Validate paired TURN
   configuration; issue Coturn REST credentials only for an authenticated owner's
   live, nonrevoked view session, with exact Origin, rate limit and no caching.
   Bind expiry to the existing deadline. Prove ownership, disabled configuration,
   expiry, revocation and HMAC compatibility using real PostgreSQL routes.
   Preserve atomic consent/audit transitions.
2. **Native/browser transport integration — implemented; Windows CI passed.** Carry matching short-lived ICE
   credentials to both peers through existing authorized paths. Extend strict
   native validation and RTC configuration. Add a bounded forced-relay acceptance
   mode, selected-candidate diagnostics and honest connection errors. Preserve
   consent, no recording/input and local lease enforcement.
   Backend/web checks and Windows native formatting, Clippy, tests and release
   build passed for `d64854f` in
   [CI run 38066791856](https://github.com/builtbysai/Beacon-Remote/actions/runs/38066791856).
   The local MSVC linker was absent during those attempts; matching CI binaries
   were used. Local C++ Build Tools and the Windows SDK are now installed and
   native formatting, Clippy, tests and release builds pass.
3. **Real relay acceptance.** Use existing Coturn without changing protected-peer
   restrictions or buying resources. Verify relay candidates and decoded native
   video on a reachable external peer; test a distinct-network path. A credential
   API alone does not complete this step. On 2026-10-10, two relay-only synthetic
   attempts from Windows through existing Oracle Coturn ended before decoded
   frames or a selected relay route could be verified. The second displayed
   “Video connection interrupted.” Root cause remains unresolved; this is failed
   acceptance, not proof of a successful TURN allocation. No desktop was captured.
   The attempt exposed a delayed playback rejection overwriting the ended status;
   the browser now ignores that rejection after shutdown.
   Follow-up diagnostics confirmed both peers obtained relay candidates. Browser-
   only forced-relay synthetic decoding and Stop passed with an existing native
   Tailscale path, including 444 presented frames. This narrows the failure but
   does not prove distinct-public-network desktop acceptance. Chrome's peer-
   reflexive candidate reporting exposed a false Direct label; diagnostics now
   honor relay-only policy and report ambiguous routes as unavailable. Unsupported
   TCP/TLS TURN URLs are rejected rather than silently skipped by native RTC.
   The permission failure is now reproduced and corrected: Coturn's wildcard
   relay mapping translated its public peer into a protected zero address. An
   isolated comparison returned `403` for wildcard and `200` for concrete mapping.
   The dynamic relay-address wrapper then enabled native/Chrome synthetic decoding
   with relay/relay selected and 667 presented frames at observation. Stop passed;
   both products' health/readiness remained healthy. Protected-peer restrictions
   remain intact. A subsequent owner test on Android over T-Mobile mobile data **did** decode
   actual Windows desktop video and pass local Stop; native logs and PostgreSQL
   recorded the sessions ending. This is a bounded single network-path acceptance,
   not the full network/failure/performance matrix. See `android-acceptance-2026-10-10.md`.
4. **Failure and UX acceptance.** Verify Stop, denial, logout, browser refresh,
   machine revoke, expiry, backend restart and network loss. Reconnect requires
   fresh authorization after the session ends; a reload may recover its ongoing
   original approval under ADR 0015. Confirm native focus/readability; measure startup,
   sustained FPS/CPU/RAM and relay usage. Pause must actually stop capture before
   a Pause/Resume control is enabled.
   Backend startup now atomically ends interrupted persisted grants with audit
   before listening, releasing busy computers after a crash. Real PostgreSQL
   checks passed for rollback on audit failure, rejection of old grants and fresh
   pending authorization. This does not replace actual Windows outage acceptance.
   October 12 continuation adds cancellable native approval: the helper reads
   signaling while the prompt is open, closes it on cancellation/disconnect/
   expiry/desktop loss, defaults to Decline and preserves the original monotonic
   deadline. Real loopback cancellation/close checks pass without approving or
   capturing a desktop. See [the consent decision](decisions/0013-cancellable-attended-consent.md).
   Actual prompt keyboard/DPI/lifecycle and desktop/network acceptance remains.
   PR #23 merged at `fed694d`; all three required merged-main jobs passed in
   [run 38215310190](https://github.com/builtbysai/Beacon-Remote/actions/runs/38215310190).
   Matching acceptance backend/web images were installed in the existing
   isolated account/database with their one-hour limit preserved; schema/role,
   readiness, unauthenticated rejection and both products' health passed.
   The paired Windows fixture remains stopped pending human testing. The
   follow-up fixes a stale quit message during prompt cleanup, with a real
   hidden-window regression. See [the validation record](consent-validation-2026-10-12.md).
   PR #24 merged at `a68a430` with reviewed-head and merged-main checks passing.
   Further native hardening makes the Stop window enforce input-desktop loss and
   the original deadline while the browser is connecting, adds dialog keyboard
   handling and destroys the window before releasing state on a loop exit.
   Local native checks and a real noninput-desktop dispatcher regression pass;
   actual physical lock/unlock and keyboard acceptance remain open.
5. **Release decision.** Review evidence, quota impact and exact-commit rollout/
   rollback. Enable production viewing only after acceptance. Production input remains disabled until its separate authorization, lifecycle and
   actual input acceptance gates pass. Independent implementation is authorized.

## Boundaries and owner dependencies

Integrate the approved design with real state across these slices; do not replace
working code with the prototype or ship simulated devices. No terminal,
or cloud media storage without an approved design.
No new services/dependencies without demonstrated need. Preserve Oracle free
allocation and Beacon View health.

Owner dependencies: further actual device/network tests for interruption and sustained
performance, Windows native consent/readability/timing feedback, legitimate signing
credentials before installer distribution, and external release prerequisites.
The Android/T-Mobile viewer already provided one real separate-network pass. Never weaken OS or
relay protections to pass tests. The owner has authorized commits to Beacon
Remote; use its feature branches and keep Beacon View changes separate.

Use the smallest useful suite at security/database boundaries plus real Windows/
browser/network checks. Report failed/skipped checks and unproven behavior;
test counts, screenshots and CI alone do not prove remote control is ready.

## Ongoing UI/UX fidelity track (parallel with technical gates)

An unsigned per-user development package now copies the matching native endpoint
pair, creates Pair/Run/Uninstall shortcuts and verifies payload integrity.
`scripts/Build-DevelopmentHost.ps1` builds and validates the native source before
packaging. It does not install service/tray/startup/update behavior. Isolated
package copy/shortcuts/executable launch/removal, unknown-file preservation and
tampered-payload rejection passed on this workstation. Owner-machine pairing/view
acceptance remains open; see [development host package](development-host-package.md).

The visual target is the owner-supplied `Beacon-Remote-Final-Package.zip` (external
attachment, **not checked into the repo**). UI completeness and backend
availability are different measures. A feature can match the target visually
while remaining honestly disabled until its secure backend exists.

| Surface                          | Integrated now                                                          | Remaining visual/functional gaps                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Public landing/download/security | React public navigation and partial approved style                      | Match prototype composition and copy; show real release/download state                                                 |
| Sign-in/account                  | Operator invitation and password login                                  | Complete visual/auth states, signup, email/MFA/recovery (milestone 7)                                                  |
| Sidebar/workspace                | Device inventory, search/status filter, inspector, inline rename        | Prototype-aligned sidebar/density/responsiveness, hide dev diagnostics from consumer UI                                |
| Sessions/Assist/Activity         | Authenticated view/audit history, browser session management            | Fill available space, real states, one-time support UI after backend capability                                        |
| Remote session                   | Attended view-only browser video, native consent + local Stop           | Polished viewer, accurate reconnect and input states; development control implemented; actual input acceptance pending |
| Windows host                     | Native helper consent/Stop control                                      | Approved idle/tray/request/active/error visual system after service/installer work                                     |
| Themes, icons, accessibility     | Blue/slate tokens and mark assets; viewport checks on integrated slices | Complete fidelity in light/dark, keyboard/touch/focus, mobile and reduced motion                                       |

For each implementation slice: compare actual desktop/tablet/mobile screenshots
against the approved prototype, fix layout/UX gaps, run accessibility/browser
checks and document remaining differences. No simulated production data.
