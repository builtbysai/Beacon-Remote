# Beacon Remote completion checklist

Current checkpoint: November 15, 2026. This is the single current completion
tracker for the owner's full-roadmap goal. The [roadmap](roadmap.md) defines
scope; [development status](development-status.md) retains dated validation
records. Historical entries do not override this tracker or grant new release
authorization. No percentage is inferred from passing builds.

Source, automated verification, physical acceptance and deployment are separate.
Current unattended/handoff work is on `codex/unattended-access`. The owner now
authorizes GitHub publication and VM deployment of verified work, excluding
physical-device acceptance. Publication/deployment receipts are recorded below;
work is not marked shipped before those actions are observed.
Real sign-in readiness/public connectability remain disabled. Device acceptance
resumes after development is ready, using the designated Windows SSH endpoint
and USB Pixel; reconfirm their identities before acting.

| Deliverable                                                | Current implementation                                                                                                    | Verification and remaining work                                                                                                                                                                                                                           | Release                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Separate sign-in authority, short leases, one controller   | In source                                                                                                                 | Backend/IPC regressions; actual SYSTEM acceptance pending                                                                                                                                                                                                 | Local only               |
| Windows sign-in video/input and browser viewer             | Integrated in source                                                                                                      | Synthetic RTC/browser and scoped-input evidence; real capture/input pending                                                                                                                                                                               | Local only               |
| Supported Ctrl+Alt+Delete                                  | Service request in source                                                                                                 | Policy/request/reply checks; actual Windows delivery and targeting pending                                                                                                                                                                                | Local only               |
| Local Disable, cleanup and worker retirement               | In source, including signed backend invalidation                                                                          | Owned-process/pipe/UI-thread and PostgreSQL/WebSocket revocation checks; disk-fault, service/recovery and real held-input checks pending                                                                                                                  | Local only               |
| Sign-in-to-desktop handoff                                 | Native attestation, backend transition and browser orchestration connected                                                | Real browser synthetic sign-in-to-ordinary-video journey and backend boundaries passed; full checks passed; actual Windows unlock pending                                                                                                                 | Local only               |
| Restart-to-sign-in and reconnect statuses                  | Integrated in source; original capability preserved                                                                       | Synthetic browser restart/sign-in/fresh desktop/Stop and delayed-readiness cancellation passed; reachable Cancel checked at desktop, narrow and short sizes; actual OS boot/restart pending                                                               | Local only               |
| Runtime readiness and connection gate                      | Opt-in build/backend gates connected to fresh worker probes and passive preflight                                         | Both native variants and backend gate/policy/freshness checks passed; actual SYSTEM/GPU/media acceptance pending                                                                                                                                          | Local only, defaults off |
| Setup, repair, startup, rollback and removal               | Separate Enable/Repair, bounded crash recovery, installed-binary drift detection and maintenance staging in source        | Both native CI variants passed November 11; read-only unpaired settings rendering/Tab/Refresh/focus/Escape verified. Paired/error/narrow/DPI review and actual installation, SCM recovery, upgrade/rollback/removal acceptance remain                     | Local only               |
| Theme control                                              | Icon-only header, concise radios, direct Settings choices and pre-React preference in source                              | Actual Chromium/synthetic-API checks passed persistence, blocked storage, live emulated OS changes, keyboard/focus/outside dismissal, forced colors, public header and eight viewport sizes including hit tests. Zoom/screen-reader/device review remains | Local only               |
| Downloads                                                  | Shared minimalist platform choices, real manifest metadata and optional setup/verification in source                      | Focused decoder regressions and Chromium synthetic-manifest published/missing/error/retry/invalid/ZIP-only/loading/public/workspace checks passed; expanded details reflow checked. Real artifacts/signatures/install remain acceptance gates             | Local only               |
| Settings                                                   | Five sections with real account identity, retained MFA/recovery state, sessions, team and separate data/deletion controls | Actual Chromium/synthetic-API interactions and responsive review passed; account identity/data lifecycle regressions passed on local test DB. Zoom/screen-reader/real account and device acceptance remain                                                | Local only               |
| Outgoing email                                             | Shared account HTML/plain text and styled operational alert payload in source                                             | Escaping/provider/payload tests, local DB one-use signup/recovery checks and dummy narrow/light/dark Chromium previews passed. Real inbox/client rendering and operational delivery remain unaccepted                                                     | Local only               |
| Setup/pairing                                              | Integrated browser status/cancellation, named completion, inventory refresh and additive migration 029 in source          | Dedicated test-DB isolation/claim/cancel/race/rollback regressions and schema verification passed; synthetic browser lifecycle/responsive evidence recorded below. Real host persistence/install/device acceptance remains                                | Local only               |
| Remaining web/native/Android design pass                   | Partially implemented                                                                                                     | Complete remaining public/auth, Computers/inspector, viewer, Assist, Activity and native/Android review; zoom, keyboard/touch/accessibility and supplied width/height standards                                                                           | Pending                  |
| Download resume                                            | Unimplemented                                                                                                             | Bounded verified resume; interrupted transfer and cancellation evidence                                                                                                                                                                                   | Pending                  |
| Existing files, audio, displays, Wake-on-LAN and reconnect | Baseline features exist                                                                                                   | Close real browser/device/network acceptance; preserve implemented upload resume and streamed downloads                                                                                                                                                   | Acceptance pending       |
| Diagnostics and performance advice                         | Partial baseline                                                                                                          | Complete measured encoder/relay/reconnect evidence and useful poor-session guidance                                                                                                                                                                       | Pending                  |
| Android requirements                                       | Baseline host exists                                                                                                      | Resolve/finish approved control, multi-touch, audio, outbound files, rotation and TV/tablet scope; physical Pixel/TV acceptance                                                                                                                           | Pending                  |
| Account reset follow-through                               | Old database accounts/data reset; new local temporary identity retained privately                                         | Historical-copy/provider retention and retired-device rejection/re-enrollment evidence; rotate/delete temporary identity at full completion                                                                                                               | Partial                  |
| Branches, PRs and dependency/security review               | Historical inventory exists                                                                                               | Fresh exact-source review, integrate appropriate work, reconcile docs and matching migrations                                                                                                                                                             | Pending                  |
| Real acceptance                                            | Incomplete                                                                                                                | Cold boot/sign-in/handoff/restart, Disable/expiry/input release, installation lifecycle, direct/relay/separate networks, files/audio/displays and recovery                                                                                                | Pending                  |
| Verified release                                           | Unreleased worktree                                                                                                       | Signed artifacts, migration/rollback/recovery review, final authorization where required, then matching deployment and smoke checks                                                                                                                       | Pending                  |
| MCP/computer-use and Motive                                | Later milestone                                                                                                           | Consent-preserving live session integration and revocable scope; view-only MCP is insufficient                                                                                                                                                            | Pending                  |
| Linux/Raspberry Pi                                         | Later milestone                                                                                                           | Supported X11/Wayland/Raspberry Pi implementation, packaging and real acceptance                                                                                                                                                                          | Pending                  |
| Organization administration/policy/audit                   | Partial membership/groups baseline                                                                                        | Approved shared administration, organization policy and richer audit milestone                                                                                                                                                                            | Pending                  |

The next development pass is the remaining web/native/Android journey review, followed by the remaining feature gaps above. Settings and mail
revisions now have local source and automated/rendered evidence; real account,
inbox/client and device acceptance remains open. Appearance and minimalist Downloads are implemented
locally with rendered browser evidence; final zoom/screen-reader/device review
remains. Windows sign-in
source integration has advanced, but actual boot/restart, SYSTEM capture/input,
handoff and recovery remain acceptance gates. No installed/public gate has been
enabled, and no current worktree release has been deployed.

November 11: both sequential native CI variants completed successfully, including
formatting, Clippy, tests and release builds. Bounded crash recovery, recovery
policy readback, installed-binary mismatch/unknown status and disabled maintenance
staging are implemented locally. Explicit administrator Repair aligns the protected
service with an upgraded/rolled-back host while preserving Disable and binding;
actual lifecycle execution remains unverified. The computer-use runtime now works.
Read-only unpaired Settings rendering and Tab/Space/Refresh/focus return/Escape
were checked. That walkthrough exposed a button-notification dispatch bug; it was
fixed and regression-tested. No service action ran. Paired/error/short/narrow/DPI
states and real SCM recovery still require review; the unpaired walkthrough does
not establish their acceptance.

November 11 appearance: actual React/Chromium synthetic-API interaction passed
all eight recorded viewport sizes, including choice hit tests. Rendered review
caught bottom navigation covering the initial panel; a portal and explicit Tab
handling fixed the overlap while preserving natural focus order. Private evidence
is `appearance-browser-2026-11-11/result.json`; clean screenshots are catalogued.
Final appearance typecheck/lint/build passed (`appearance-checks-2026-11-11.log`),
and the web suite passed earlier in the same pass. No release was deployed.

November 11 Downloads: Windows/Android share a concise public/workspace component,
with real manifest metadata, always-visible availability and optional setup/trust/
checksum details. Network/malformed-manifest failures have retry; 404 is a distinct
unpublished state; requests are bounded and canceled on navigation. Invalid local
filenames, hashes, sizes and dates cannot become download actions/trust claims.
Focused parser regressions and real browser synthetic-manifest published/missing/
error/retry/invalid/ZIP-only/loading/public/workspace checks passed. Expanded details
were checked for reflow at phone/tablet/desktop/short sizes. Actual published files,
signature/install and device acceptance remain release checks.

Passkeys/OAuth, macOS/iOS hosting, general terminal/privileged commands and cloud
media storage are not silently added to the approved scope. Keep permission and
consent boundaries intact; leave genuine human-only acceptance steps explicit.

November 11 Settings/mail: five-section navigation preserves unfinished MFA and
recovery state. Account metadata is authenticated and no-store; export form reset
and contextual team/session/data outcomes are fixed. Real browser/synthetic-API
walkthrough and dedicated test-DB account/signup/recovery regressions passed. All
account mail paths now share HTML/plain text; operational alerts preserve their
diagnostics in both. Dummy-only narrow/light/dark previews were reviewed. Provider
sending was mocked; real email delivery and client acceptance remain open. Evidence:
`settings-mail-backend-2026-11-11.log`, `settings-mail-static-2026-11-11.log`,
`settings-mail-browser-2026-11-11.log` and the catalogued clean screenshots.

November 11 pairing: browser setup now shows the actual workspace address and
server-issued code, confirms the named device and refreshes inventory. Explicit
cancellation is owner-scoped and serialized with claim; server expiry is also
lowered to prevent old-backend rollback from reviving cancelled codes. Migration
029 and the matching backend must precede rollout; neither development nor hosted
schema was changed. Evidence: `pairing-backend-2026-11-11.log`,
`pairing-cancel-rollback-2026-11-11.log`, `pairing-static-2026-11-11.log` and
`pairing-browser-2026-11-11.log`. Native/device acceptance remains open.
Final type checks, changed-source lint, web/backend builds and browser lifecycle
review passed. Final web build evidence is `pairing-web-final-2026-11-11.log`;
the legacy-claim regression was rerun after making status expiry use database
time. Reviewed desktop/phone screenshots are catalogued under validation/pairing.

November 11 support/public: Assist code, queue and shared-computer entry points
now share an in-flight guard; guest support uses the same late-grant cleanup.
Navigation/auth/sign-out boundaries discard and Stop delayed grants rather than
opening a viewer. The actual browser/synthetic-API walkthrough passed cross-panel
exclusion, four late-grant Stop paths (including failed sign-out), shared-list
retry and public Security reflow. Stale public feature placeholders/copy were
corrected. Evidence: `support-public-browser-2026-11-11.log` and
`support-public-static-2026-11-11.log`. Full authentication, inventory/viewer/
Activity and native/Android review, accessibility and real-device acceptance
remain open. No publication or deployment occurred.
