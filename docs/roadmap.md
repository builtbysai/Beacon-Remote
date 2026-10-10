# Beacon Remote delivery roadmap

Updated 2026-10-10 after reviewing the original product brief, approved design
package, backend, browser and native Windows implementation and acceptance logs.

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
| Media                    | Native H.264 → Chrome, real local desktop decoding, consent, Stop/logout/expiry and lease enforcement | Distinct-network desktop acceptance and restart/loss matrix                                    |
| Approved interface       | Real inventory/inspector/naming, activity/history/browser sessions; responsive/theme checks           | Complete native host states, permission focus/readability feedback and backend-dependent flows |
| Deployment               | Isolated Oracle control plane, HTTPS, encrypted backup/restore and rollback                           | Production media intentionally disabled; input absent                                          |

The deployed interface is release `ff452ffe66dd600e9a7b18d12fccc08ac970a7d6`.
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
   remain intact. Actual separate-network desktop acceptance is still required;
   the owner currently has no second device/network.
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

Owner dependencies: a second network/peer for transport acceptance, human native
consent/Stop/readability feedback, legitimate signing credentials before installer
distribution, and external release prerequisites for later milestones. Never weaken OS or
relay protections to pass tests. The owner has authorized commits to Beacon
Remote; use its feature branches and keep Beacon View changes separate.

Use the smallest useful suite at security/database boundaries plus real Windows/
browser/network checks. Report failed/skipped checks and unproven behavior;
test counts, screenshots and CI alone do not prove remote control is ready.
