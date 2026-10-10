# Beacon Remote delivery roadmap

Updated 2026-10-10 after consolidating PR #8 (attended media) and PR #9
(approved UI, relay, recovery), reviewing the design package, CI and owner
mobile-data acceptance. See [Claude handoff](CLAUDE_HANDOFF.md).

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

| Area                     | Working evidence                                                                                      | Remaining gate                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Foundation               | Backend/web and native Windows CI builds                                                              | Local native linker absent; use Windows CI for compilation                                     |
| Account/machine identity | Private invitations/login, actual pairing, DPAPI persistence, signed presence, restart and revoke     | Public account lifecycle, MFA/recovery and retention/deletion                                  |
| Capture                  | Actual attended primary-display WGC capture, snapshot interface and measurements                      | Sustained performance, lock/display-loss behavior, broader hardware                            |
| Media                    | Real native H.264 in Chrome, local Stop; owner confirmed Android/T-Mobile separate-network desktop viewing + Stop | Full interruption/recovery, sustained performance, broader route/hardware acceptance |
| Approved interface       | Real inventory/inspector/naming, activity/history/browser sessions; responsive/theme checks           | Complete native host states, permission focus/readability feedback and backend-dependent flows |
| Deployment               | Isolated Oracle control plane, HTTPS, encrypted backup/restore and rollback                           | Production media intentionally disabled; input absent                                          |

The last documented deployed interface is release `ff452ffe66dd600e9a7b18d12fccc08ac970a7d6`.
PR #8 was merged as `d6c40c8`, PR #9 as `6d8d7496` into main. CI was
successful at PR #9 head `0979cd1` (run 38083605846); merged code is **not**
proof of a new deployment or production media approval.
Local follow-up changes are not deployment evidence. A synthetic stream is not
desktop acceptance; a local direct connection is not relay acceptance. Consent
audit proves permission, not that a viewer decoded media.

## Ordered milestones

Historical milestone numbers are retained. Work on one active milestone at a
time. Milestone 4 remains active. The owner's continuation request authorizes
milestones 5–8 in sequence after their prerequisites pass. Ordinary implementation
needs no repeat approval; external release gates still apply.

| Milestone                              | Status                            | Deliverable and completion gate                                                                                                                                  |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Research/architecture              | Foundation recorded               | Existing capture/encoding/transport decisions remain measured prototypes; refine using evidence                                                                  |
| 1 — Repository foundation              | Implemented                       | Formatting/lint/types/backend regressions and native Windows CI remain green                                                                                     |
| 2 — Identity/presence                  | Private-alpha acceptance passed   | Pair real agent, survive backend restart, expire stale presence and reject revoked identity                                                                      |
| 3 — Capture                            | Initial acceptance passed         | Visible primary-display capture and bounded snapshot path; broader hardening belongs in media/resilience gates                                                   |
| **4 — Attended WebRTC media**          | **Active**                        | Authorized direct and forced-relay real Windows/browser viewing, explicit local consent/Stop, safe loss/restart/expiry and measured behavior                     |
| 5 — Authorized input                   | Authorized; prerequisites pending | Separate view/control approval, typed DataChannels, one controller, pointer/buttons/drag/scroll/keys/modifiers, held-input release on shutdown, respect UIPI/UAC |
| 6 — Resilient installation             | Authorized; prerequisites pending | Least-privilege service/interactive helper, restricted IPC, visible status/tray, reboot recovery, signed installer/update/rollback and clean uninstall           |
| 7 — Consumer account/release readiness | Authorized; prerequisites pending | Reviewed signup/email verification, MFA/recovery, credential rotation, retention/deletion, abuse limits and complete account/support flows                       |
| 8 — Production UX and reliability      | Authorized; prerequisites pending | Complete approved responsive UI, actionable lifecycle errors, accessibility and attended temporary support with distinct view/control approval                   |

Account lifecycle is a general-consumer release gate. It can be reprioritized by
the owner, but unfinished recovery/MFA screens remain honestly unavailable.
Guest support needs scoped authorization, expiration and local approval; it must
never inherit computer access from a camera or a public support code.

## Current milestone 4 implementation sequence

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
   The local MSVC linker remains absent; matching CI binaries were used for the
   actual browser/native relay attempts.
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
   fresh authorization. Confirm native focus/readability; measure startup,
   sustained FPS/CPU/RAM and relay usage. Pause must actually stop capture before
   a Pause/Resume control is enabled.
   Backend startup now atomically ends interrupted persisted grants with audit
   before listening, releasing busy computers after a crash. Real PostgreSQL
   checks passed for rollback on audit failure, rejection of old grants and fresh
   pending authorization. This does not replace actual Windows outage acceptance.
5. **Release decision.** Review evidence, quota impact and exact-commit rollout/
   rollback. Enable production viewing only after acceptance. Input remains
   unavailable until milestone 4 passes and milestone 5 is implemented.

## Boundaries and owner dependencies

Integrate the approved design with real state across these slices; do not replace
working code with the prototype or ship simulated devices. No AI, MCP, terminal,
file transfer, recording, extra OS, enterprise management or cloud media storage.
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

The visual target is the owner-supplied `Beacon-Remote-Final-Package.zip` (external
attachment, **not checked into the repo**). UI completeness and backend
availability are different measures. A feature can match the target visually
while remaining honestly disabled until its secure backend exists.

| Surface | Integrated now | Remaining visual/functional gaps |
| --- | --- | --- |
| Public landing/download/security | React public navigation and partial approved style | Match prototype composition and copy; show real release/download state |
| Sign-in/account | Operator invitation and password login | Complete visual/auth states, signup, email/MFA/recovery (milestone 7) |
| Sidebar/workspace | Device inventory, search/status filter, inspector, inline rename | Prototype-aligned sidebar/density/responsiveness, hide dev diagnostics from consumer UI |
| Sessions/Assist/Activity | Authenticated view/audit history, browser session management | Fill available space, real states, one-time support UI after backend capability |
| Remote session | Attended view-only browser video, native consent + local Stop | Polished viewer, accurate reconnect and input states; control after milestone 5 |
| Windows host | Native helper consent/Stop control | Approved idle/tray/request/active/error visual system after service/installer work |
| Themes, icons, accessibility | Blue/slate tokens and mark assets; viewport checks on integrated slices | Complete fidelity in light/dark, keyboard/touch/focus, mobile and reduced motion |

For each implementation slice: compare actual desktop/tablet/mobile screenshots
against the approved prototype, fix layout/UX gaps, run accessibility/browser
checks and document remaining differences. No simulated production data.
