# Beacon Remote delivery roadmap

The [completion checklist](completion-checklist.md) is the current tracker for
the full-roadmap goal; dated sections below preserve scope and historical evidence.

Updated November 15, 2026. [PR #124](https://github.com/builtbysai/Beacon-Remote/pull/124)
is merged (`008a5bb`); tested application revision `5e8d5c5` is deployed to the VM.
Android UI/lifecycle, reviewed dependency updates and prior-password-hash
compatibility passed. Signed Windows/Android candidates are staged privately.
Backup/integrity/isolated restore/schema, ARM64 runtime and Remote/View health
checks passed. Native feeds remain unchanged and Windows sign-in gates are off.

What remains:

- Continue from the matching isolated acceptance backend/schema and fresh private
  test account prepared November 16. A limited Surfiena fixture passed actual
  view-only video and browser Stop with owner approval. The Pixel update preserved
  its data; Pixel-host and wider device acceptance remain open.
- Startup-speed comparison passed on Surfiena: signed `9d377c6` acknowledged in
  208 ms and the owner confirmed Online was quick. Finish the follow-up native
  UI publication: the owner confirmed the signed `d3bd11c` toggle and absence of
  a new terminal. Defer further layout choices until core acceptance as requested.
  Repeat view/Stop passed, but media startup still took 11.8 seconds on relay;
  diagnose that separately. Connection-time blinking was seen once, not on repeat.
- Add in-session requests for more access (owner request, November 16). A
  view-only connection must be able to request control and reopen permission
  approval for files/audio/recording. Preserve one controller, release existing
  input and require fresh local approval for increased access; never expand an
  existing grant silently. This flow is unimplemented.
- Fix Android's case-sensitive enrollment: its pairing screen uppercased the
  server's mixed-case base64url code. Signed `b17549a` preserves case and is
  installed on the Pixel without clearing data; actual pairing remains pending.
  The owner requested shorter codes: readable 12-symbol grouped codes now pass
  real-database regression; finish full checks, the isolated service update,
  actual Pixel pairing and publication. The dummy emulator regression did not
  run because cold boot exceeded its readiness bound.
- Complete Windows cold boot/sign-in/secure attention/handoff/restart, Stop/
  Disable/input release, service recovery and installation/upgrade/rollback/
  removal acceptance. Complete Android real sharing, permissions, lock/revoke,
  rotation and network acceptance. Verify direct/relay and actual files/audio/
  displays/Wake-on-LAN/reconnect behavior.
- Finish ordinary viewer/native journey review and actual screen-reader checks.
  Five workspace screens, theme/inspector and download actions now pass real
  200% browser zoom; extend that review to remaining public/auth/viewer routes. Paired/error/narrow/DPI native states remain unverified; the
  attempted unpaired resize did not establish changed bounds.
- Remove the earlier retained dummy browser profile identified in the private
  cleanup receipt; automatic approval review denied explicit deletion.
- Resolve historical-copy/provider retention and retired-device rejection/
  re-enrollment evidence; rotate/delete the retained temporary account after
  full completion. Do not repeat the completed account reset.
- Finish measured diagnostics/performance evidence and the explicitly tracked
  Android feature gaps (multi-touch, audio, outbound files and TV/tablet scope).
- Later implementation milestones remain full scoped computer use/semantic UI
  trees/automation tokens/Motive integration, Linux/Raspberry Pi hosting and
  organization administration/policy/audit. Stage-one view-only MCP is published;
  these larger capabilities are not delivered by it.
- Advance native downloads/update feeds only after the matching signed candidates
  pass the required physical acceptance. Full unattended access is not yet accepted.

The single [completion checklist](completion-checklist.md) records the evidence
and publication receipts. The sections below are earlier dated checkpoints.

### Earlier November 15 publication records

Updated November 15, 2026. [PR #115](https://github.com/builtbysai/Beacon-Remote/pull/115)
is merged and its verified head `79e2532` was deployed to the VM. Web/backend UI,
account mail, pairing, guarded sign-in source and verified download-resume source
are published. All four CI jobs, ARM64 release image builds, additive migrations
025–029, encrypted backup/integrity/isolated restore and both products' health and
readiness passed. Sign-in access remains disabled; native update feeds were not
advanced. Full unattended/device acceptance is still open.

[PR #116](https://github.com/builtbysai/Beacon-Remote/pull/116) is also merged;
its verified head `7d59941` was deployed before #117. Computers/details, Sessions
and Activity now have eleven-viewport browser interaction/render evidence and
scheduled recovery selects exact release images. Signed Windows default/sign-in
and Android candidates were built without advancing native feeds.

[PR #117](https://github.com/builtbysai/Beacon-Remote/pull/117) is merged as
`713f58c`; its verified head `96f64ec` was deployed before #124. The original
view-only MCP #105 is closed; bounded live screenshot/Stop/profile-cleanup
integration is published. All four CI jobs and the VM recovery/schema/health
checks passed again. This does not add automated input or Motive integration.

Android's follow-up native UI and delayed-response fixes passed a guarded dummy
API/emulator review, including large text, dark mode, consent expiry across
configuration changes, queued pairing completion, cancelled late enable and a
stale presence rejection after Stop/restart. Real device/capture/input acceptance
remains open; signed candidates and source publication passed in #124.

The current follow-up is the remaining viewer/native/Android design review,
diagnostics and reset follow-through. Included dependency PRs and the superseded
direction PR were closed. #105 view-only MCP is integrated and published with stdio/core and real local
synthetic-RTC evidence. Full computer-use/Motive, Linux/Raspberry Pi
and organization policy remain later implementation milestones, not delivered
features. The checklist distinguishes those from physical acceptance. Earlier
dated notes below retain historical evidence; the database reset must not be
repeated.

Current November 10 source connects sign-in video/input, supported secure
attention requests, worker retirement, fresh desktop handoff and automatic
restart entry. Synthetic browser journeys and control-plane checks passed;
actual Windows behavior remains unaccepted and readiness disabled. The host now
has separate sign-in setup/repair/status/Disable/removal controls, and signed
local Disable invalidates pending/issued handoffs on the backend. Native and
control-plane checks passed. Read-only unpaired native rendering/keyboard review
now passed; paired/error/narrow/DPI and physical review remain. Readiness/preflight is now
connected behind default-off native/backend gates; both build variants passed.
Repair service preserves Disable and backend binding, with explicit Enable kept
separate. Candidate packaging checks capability and remains unrun/unreleased.
Bounded crash recovery and protected-service drift/repair handling are implemented
locally, with both native variants passing November 11; actual SCM/install/upgrade/
rollback behavior remains unaccepted. Appearance revision now has local browser
evidence. Minimalist Downloads now has synthetic-manifest/browser evidence;
Settings and email revisions now have local source and rendered/automated
evidence; pairing now has local status/cancellation/completion evidence, with additive
migration 029 pending deployment. The remaining journey review follows. Use the checklist
for current gaps; dated prerequisite
notes below are historical, not instructions to rebuild completed components.

## November 8 owner review: completion plan

**Full unattended access is not complete.** Ordinary signed-in Windows standing
access and Android's locally enabled accessibility path exist. Initial Windows
sign-in control has initial native H.264/RTC/input wiring but still lacks the
integrated browser flow, complete visible session/Stop integration and fresh
ordinary-desktop handoff.
Backend authority, protected service/worker lifecycle, capture/input adapters,
lease discovery/revalidation/delivery and initial controller-label acknowledgement
exist in local source. Readiness remains false. Passing source checks do not prove
SYSTEM secure-desktop behavior, device acceptance or hosted availability.

The initial native signaling client now has passing loopback wire regressions
and warning-denied agent Clippy. The previously incomplete fixture is finished;
it independently verifies the worker proof, negotiation and scope-Stop closure.
Wrong-scope/binary messages also end authority over real sockets. This client
does not itself connect the media gate. The new separate native media runner
consumes signaling and gates capture/input on actual RTC Connected; browser and
positive SYSTEM/media checks remain open. Full native CI is tracked in
development status. Nothing in
this checkpoint enables readiness or resumes device testing.

November 9: a browser reservation/renewal lifecycle and strict shared response
schemas now connect to a separate browser signaling/media/input viewer, short
lifecycle timer and inspector entry. Protocol/cancellation regressions and a real
Chrome synthetic RTC walkthrough passed; screenshots cover desktop/phone/short
landscape. Restart entry, supported secure attention, persistent Disable failure
handling and fresh ordinary-host handoff remain unfinished. The real backend/
native readiness gates remain false. See development status for full checks;
browser fixtures do not establish SYSTEM or physical-device acceptance.

The subsequent local Disable pass now forwards failed saves over private IPC,
latches supervisor revocation and separates pending cleanup from durable
confirmation. A responsive Retry-only worker is retained after media cleanup
while persistence fails; unconfirmed/stalled cleanup is bounded and terminated.
This closes the ordinary save-failure/relaunch source path. Actual SYSTEM
service, disk-fault/recovery and reboot evidence remain open, and no durable
success is claimed while storage is unwritable. Secure attention, restart entry
and fresh ordinary-host handoff remain implementation work.

The next November 9 checkpoint adds the viewer's fixed Ctrl+Alt+Delete request,
tracked-input release, bounded native mailbox and authenticated private forwarding.
The service revalidates backend/local authority before the supported Windows
`SendSAS` call, using only its own worker token for console targeting. Explicit
service-allowing Windows policy is required and is never rewritten by this path.
Browser feedback distinguishes invocation from delivery. Source/browser checks
are recorded in development status; actual SYSTEM/policy/session targeting and
delivery remain unaccepted. Restart entry and fresh ordinary-host handoff remain
implementation work. Readiness/public connectability remain false.

The following handoff pass adds ordinary-host console binding: signed heartbeat
v3, additive migration 027, verified inventory metadata and optional exact host
pins on fresh owner-policy desktop grants. Host/console change or legacy
downgrade permanently ends those pinned grants; normal ordinary requests retain
their existing behavior. PostgreSQL and loopback WebSocket regressions exercise
the boundary. Confirmed worker teardown/unlock attestation, browser-bound
transition/Stop behavior, fresh-grant orchestration and restart entry remain
implementation work. This source prerequisite does not enable handoff or raise
readiness. See development status for current validation/rollout requirements.

Native worker retirement now has a final private challenge/reply and process
exit confirmation, preserving final local Disable requests and preventing new
authority while draining. Owned-child/pipe and UI-thread regressions cover
cleanup failure, mismatched identity, crash and forced termination. This adds
the local teardown evidence needed for handoff; scoped unlock attestation,
exact-browser transition/cancellation and fresh ordinary-grant orchestration
remain unfinished. No real-device/readiness gate was raised.

The original approved idea is one coherent product: browser workspace,
Windows/Android host setup and pairing, owner unattended access, attended/guest
support with visible control, reliable reconnect and a consistent interface.
The approved [design specification](../design/prototype/DESIGN_SPEC.md) and
[ADRs 0047](decisions/0047-unattended-owner-access.md)/
[0048](decisions/0048-boot-login-and-restart.md) define that scope. Automation/Motive
is a later requested milestone; the unmerged view-only MCP work does not deliver
full computer use. Working features must be preserved during the redesign.

### Execution order when the owner resumes development

1. **Finish the reset follow-through.** The four database resets, recovery
   verification and fresh private local test identity are already recorded.
   Finish historical-copy/provider retention handling and offline endpoint
   refusal/re-enrollment evidence. Do not wipe the new baseline again. Rotate or
   delete fresh temporary identities and their private records at completion.
2. **Finish unattended implementation.** Connect authenticated sign-in signaling,
   encoder/video/input and browser controls; integrate controller identity,
   local Stop, expiry, peer loss, input cleanup acknowledgement and frame discard.
   Implement supported secure attention where required and fresh-policy handoff
   to the enrolled user's host. Preserve Windows authentication and account
   boundaries. Complete honest boot/restart/sign-in/reconnect statuses.
3. **Deliver the UI/email revision as one coherent pass.** Start with shared
   appearance/components, then Downloads and Settings, then remaining journeys
   and outgoing email. Use the concrete scope and acceptance criteria below;
   implement against real state, not prototype success placeholders.
4. **Review and integrate exact source.** Recheck open branches/PRs, reconcile
   #113, prepare the unattended implementation PR, review dependency/security
   updates and current CI, and remove contradictory historical status copy from
   README/setup/help. Do not silently merge stale lockfiles or delete branches.
5. **Resume acceptance after development is ready.** Full app walkthrough,
   fresh-account email flows, Windows/Pixel, sign-in/handoff/reboot/recovery,
   installation/upgrade/uninstall and actual direct/relay/separate-network tests.
   Then review matching migrations 023–026, signed artifacts and rollback for an
   intentional release. No current local change has been deployed.
6. **Take later milestones separately.** Live consented MCP/computer-use/Motive,
   other host platforms and richer organisation administration remain distinct
   work; they must not be represented as shipping capabilities.

### Design, UI and UX revision

The owner supplied `C:/Users/Saiha/Downloads/Universal_UI_Responsiveness_Viewport_Standards.md`
as a design reference. Its relevant criteria are captured here so future goal
runs do not depend on the attachment or this chat. The requested deliverable for
this pass is the roadmap; the redesign itself remains queued.

| Surface        | Required change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Completion evidence                                                                                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance     | Replace the current `theme-trigger` treatment with a quiet, consistent appearance control. Use a compact theme icon button in the header and a small anchored Light/Dark/System selector with a clear selected state; expose the same three-way choice directly in Settings. Remove repeated explanatory rows and decorative chevrons where they add no value. Preserve persisted preference, live OS-theme changes, keyboard/radio semantics, Escape/focus return and an accessible current-value name. | Real interaction in light/dark/system, OS theme changes, storage unavailable, keyboard/screen reader, forced colors and narrow/short viewports; no clipped popover or theme flash.                                                                                                                          |
| Downloads      | One short title and concise Windows/Android choices, each with a clear download action and platform/version/size metadata from the real release manifest. Place setup, checksum, signing/trust and alternate-package detail behind purposeful disclosure or a setup guide. Remove repeated paragraphs, onboarding essays and prominent command/hash blocks. Keep one brief truthful trust warning when necessary; never replace trust verification with blanket instructions to bypass warnings.         | Both published/unavailable/loading/error states, actual artifact links and metadata, readable optional verification details, desktop/mobile screenshots and working keyboard/touch. Public and workspace Downloads use the same components.                                                                 |
| Settings       | Replace the stacked panel collection with clear Appearance, Account, Security & sessions, Team/access and Data & deletion sections. Use restrained section navigation on wide screens and simple accessible navigation/stacking on phones. Group related controls in aligned rows, use brief contextual help, show saving/saved/error beside the affected control, and visually separate destructive actions. Keep computer-specific permissions with the computer.                                      | Real settings persist; MFA, recovery/session revocation, team roles, export and deletion remain reachable and functional. Long content, errors, browser zoom and virtual keyboards do not obscure actions or trap scrolling.                                                                                |
| Outgoing email | Inventory every mail-producing path, including operational alerts separately from account mail. Account confirmation and password reset currently send plain text only. Add a shared restrained Beacon Remote HTML template plus equivalent plain text: recognizable sender, concise subject/preheader, one primary action, honest expiry, fallback URL and short security footer. No tracking pixels, remote-font dependence, decorative marketing blocks or exposed credentials in previews/logs.      | Escaped content/URLs, unchanged one-use token/expiry behavior, local previews using dummy tokens, narrow/light/dark/images-off rendering and real fresh-account confirmation/reset delivery. Exercise expired, used and failed-send states. Operational alerts retain all necessary diagnostic information. |
| Entire product | Review public/auth/pairing, Computers/inspector, Sessions/viewer, Assist, Activity and native/Android surfaces against the approved V6 language. Use consistent typography, spacing, icons, buttons, form labels and interaction feedback. Remove redundant copy and repeated card wrappers; do not fill space with generic dashboard widgets, gradients or decorative status. Show real offline, revoked, pending, reconnecting, loading, empty and error states.                                       | End-to-end journeys with actual backend/native state, screenshots reviewed for hierarchy and usability, keyboard/touch/screen-reader/reduced-motion checks and no removal of working capabilities.                                                                                                          |

Use layouts suited to each screen: stable flexible workspace regions, natural
scrolling for public content and grouped settings/forms. Account for width AND
height, split windows, safe areas, long identifiers and virtual keyboards. Use
intrinsic Grid/Flex sizing and scoped scrolling; no global overflow hiding,
arbitrary minimum-height stacks, compressed text or hidden controls to force fit.

Review representative 1920×1080, 1440×900, 1366×768, 1280×720, 1024×768,
768×1024, 390×844, 360×640 and 844×390 viewports, plus the approved design's
320px width. Include browser zoom/enlarged text, menus/dialogs, expanded content,
long labels, error states and orientation changes. Verify actual rendered output
and interactions; an overflow test or screenshot at one size is insufficient.
Accessibility, functionality and content access take priority over avoiding
scrollbars. Record any untested platforms honestly.

### Requested clean-slate account/data reset

November 8 execution checkpoint: [the reset record](account-reset.md) now records
the committed reset of all four databases after independent encrypted recovery,
passing current/legacy regressions, empty-store checks and refusal of both old
production logins. Current obsolete credential records/canonical dumps and known
plaintext staging copies were removed with hash/path guards. Fresh local test
credentials follow the clean baseline. Historical backup/provider/server
artifacts and offline endpoint refusal/re-enrollment remain open; do not repeat
the account wipe against fresh identities while finishing those gates.

The owner explicitly requests removal of **all existing Beacon Remote accounts
and their associated data, including testing accounts**, with fresh accounts
created afterwards. This supersedes the earlier instruction to retain temporary
test identities until full completion. The initial roadmap-only update queued
the work; its subsequently executed database reset is recorded above.

- Inventory local development/test, retained acceptance and hosted Remote
  accounts and associated computers/enrollments, browser/MFA/recovery sessions,
  guest/support links, teams/helpers, leases, pending commands, activity and
  account-linked files. Review cascade coverage for migration 025 and external
  stores; deleting rows from `accounts` alone is not proof of complete erasure.
- Before deletion, make and restore-test an independent encrypted backup as
  required by workspace policy. Record its retention/expiry and the treatment of
  older backups and provider-held email/log data. A recoverable backup still
  contains data; do not claim irreversible erasure while copies remain. Prevent
  accidental restoration/reuse of retired identities.
- Stop/revoke active Remote authority, execute bounded environment-specific
  deletion, and verify zero old accounts and no usable related sessions, grants,
  invitations or enrollments. Offline devices must lose server authority and
  require deliberate fresh enrollment; verify this on reconnection.
- Remove obsolete Remote test-account credential records/private fixture data
  within the verified scope, then create only the fresh identities needed for
  testing, stored securely outside Git. Rotate/delete those at completion.
  Preserve shared signing keys, SSH/server secrets, Windows/Android OS accounts
  and Beacon View/Motive data. Account reset is not machine or volume cleanup.
- Produce a sanitized per-environment result and list any retained recovery or
  third-party copies with their deletion/expiry status. No secret values or
  personal account list belongs in the roadmap/report.

### Gaps and opportunities to keep visible

| Priority                 | Gap                                                                         | Plan                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required                 | Full unattended sign-in/control/handoff is unfinished                       | Finish the integrated path and then actual SYSTEM/desktop/device acceptance; keep readiness false until supported.                                                                                          |
| Required                 | Setup still requires too much interpretation                                | Give each platform one clear install/pair/access-policy journey, accurate permission/readiness feedback and a visible way to disable/revoke. Windows administrator and Android OS consent remain explicit.  |
| Required                 | Implemented features lack complete real-world evidence                      | Close the acceptance backlog below, including file interruption, multi-monitor, audio, Wake-on-LAN, sleep/reconnect and relay tests.                                                                        |
| Required                 | Current documentation mixes old release assumptions with new source         | Align README, roadmap, setup/help, download metadata and release notes with verified implementation/deployment status.                                                                                      |
| Follow-up implementation | Download resume is missing                                                  | Implement bounded verified resume separately from already implemented upload resume; preserve streamed downloads/cancellation.                                                                              |
| Scope to resolve         | Android multi-touch/audio, outbound phone files and TV/tablet experience    | Establish what is implemented versus required, make capability limitations visible and implement agreed platform work; do not promise lock/PIN or protected-content bypass.                                 |
| Later                    | Full MCP/computer-use/Motive, Linux/Raspberry Pi, organisation policy/audit | Retain as separate milestones. Passkeys/OAuth, macOS/iOS hosting, terminal/general privileged commands and cloud media storage are not existing promised features; assess only under an explicit new scope. |

Additional Settings opportunity: the reviewed UI/routes expose current-browser
and expiry information plus bulk end-others, rather than individual browser
revocation or a direct signed-in password-change flow. Evaluate those additions
with reauthentication, useful session identification, minimal retained metadata
and explicit invalidation behavior. Existing password recovery/MFA should remain
intact; these are proposed improvements, not previously completed features.

No numerical feature-completion percentage is justified: source implementation,
live deployment, physical acceptance and design completion have different gates.

November 8 local development includes a separate, default-off backend sign-in
credential/lease boundary (migration 025) and native protected installation,
service supervision, scoped worker/IPC lifecycle and offline local disable.
The worker Disable UI, initial guarded DXGI readback and native lease scopes
exist in source, including rotation/cursor composition that awaits GPU acceptance.
An initial scoped input adapter now exists with fake-sink cleanup regressions;
initial native/browser transport and controls are now wired in source. Actual
OS interoperability, persistent Disable failure handling and fresh desktop
handoff remain unfinished; [the current implementation contract](signin-authority.md)
records that boundary. Device testing is paused by owner direction while source
development continues. [The live branch/PR review](branch-review-2026-11-07.md)
accounts for the branches and nine open PRs at that review date. Existing temporary
credentials now refer only to the fresh post-reset local identity. Supervisor
lease discovery, separate signed revalidation and private worker delivery now
exist in source; actual SYSTEM/worker acceptance remains open.

Worker transport identity is now prepared in source: each worker keeps a fresh
ephemeral secret and sends only its public key over private IPC. Signed v2
supervisor presence attests that key with additive migration 026, and same-instance
replacement/downgrade ends existing grants. Backend worker-signed/browser
signaling is now implemented and exercised over loopback TCP with real PostgreSQL.
The initial native signaling client now passes focused wire checks. An initial
shared-encoder/RTC/scoped-input runner is now wired into the worker in source.
Restart-to-sign-in entry, persistent local Disable failure handling, supported secure attention,
adaptive sign-in quality, handoff and positive SYSTEM/physical acceptance remain
open; readiness and public connectability are still false.

### Completion gates for the next goal run

- **Development ready:** finish actual peer/video/input integration, local Stop
  persistence/failure behavior and
  fresh-authority handoff; complete the shared theme, Downloads, Settings and
  email work above. Check real loading/error/revoked states, rather than adding
  more placeholder screens. Keep unsupported capabilities visibly unavailable.
- **Design ready:** review rendered public and signed-in journeys in light,
  dark and system appearance across the viewport matrix above. Verify hierarchy,
  concise copy, keyboard/focus, touch, enlarged text, short windows and dialogs.
  The current source review is not a new visual acceptance pass of the hosted
  page; the web fetch could not inspect it in this assessment.
- **Acceptance ready:** reconcile current source/PRs and dependency findings,
  pass checks for the exact saved changes, prepare matching migrations and
  signed artifacts, then resume the explicitly scheduled device walkthrough.
- **Release ready:** demonstrate cold boot/sign-in/control/handoff, persistent
  local disable, disconnect/expiry/input cleanup, Windows/Pixel and direct/relay
  operation; verify upgrade, rollback, uninstall and recovery. Review the pinned
  operational backup image update as well as application images. A green build
  or healthy backend does not close these gates.

Human participation remains necessary for OS administrator/permission prompts
where required, physical power/network scenarios that cannot be controlled from
the available devices, intelligible audio judged by ear and final subjective
usability review. Automate the remaining reproducible checks where supported;
record unavailable evidence instead of inferring it.

## Source and historical release checkpoint

The current local branch is `codex/unattended-access` at `8df0741`, with substantial
uncommitted sign-in development described above. The November 7 branch review
found no implementation PR; PR state was not refreshed in this planning pass.
The last recorded hosted web/download release is `eb1ea99a`, with backend source
`2721aae` (October 29 deployment check). November credential maintenance retained
exact running images: it did not release this source or apply migrations 023–025.

The owner has no external production users and approved fresh signing identities, installation and re-enrollment. The inventoried credentials, database consumers, backup passwords and signing material were refreshed November 1; cleanup finished November 2. Do not repeat rotation as a product milestone. Source public update pins are new; old downloaded installers/APKs are not compatible recovery baselines for new signing trust.

The earlier artifact checkpoint recorded `BeaconRemoteSetup-5f019c49.exe`, the
matching `BeaconRemoteDevelopment-5f019c49` folder/ZIP/trust folder and
`BeaconRemoteHost-4e7a39fc.apk`. These do not represent today's uncommitted source.
Historical native CI, hashes and signatures are not current install/media
acceptance. Rebuild matching signed artifacts before acceptance/release. The
owner-approved [visual reference](../design/prototype/README.md) uses simulated
flows, not implemented product behavior.

## Active milestone: finish unattended owner access

The owner's October 20 direction is in [PR #113](https://github.com/builtbysai/Beacon-Remote/pull/113). The October 30 clarification explicitly requires optional boot startup, control at the initial Windows sign-in screen and fresh-policy reconnect after restart. Signed-in-only access does not complete this milestone. [ADR 0047](decisions/0047-unattended-owner-access.md), [ADR 0048](decisions/0048-boot-login-and-restart.md) and [unattended-access.md](unattended-access.md) define the boundary.

| Area                                    | Current evidence                                                                                                                                          | Remaining work                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Windows standing owner access           | Local opt-in, owner control/files, sign-in startup, visible Pause/Stop and local revocation are implemented; process/database fixtures passed             | Real installed-host and cross-network acceptance                                                                                        |
| Optional boot presence                  | Separate presence-only credential, restricted install/ACL checks, explicit locked/signed-out readiness and service-aware forget/uninstall are implemented | Administrator-approved install/repair/reboot/uninstall on a designated test PC                                                          |
| Windows initial sign-in capture/control | Integrated sign-in media/input, secure attention, retirement and fresh ordinary handoff in source; readiness remains false                                | Finish restart entry/setup/readiness and final Disable failure feedback; accept actual SYSTEM sign-in/handoff on devices                |
| Restart recovery                        | Signed host-process marker, bounded wait and fresh authorization implemented; migration 024 and local fixtures checked                                    | Actual Windows restart/fast restart, cancellation, console switch and end-to-end handoff; a host-process restart is not proof of reboot |
| Android 11+ unattended                  | Local standing opt-in, accessibility screenshots, owner-policy intersection, notifications and Stop implemented; unit/build/emulator evidence recorded    | Physical phone, protected content, permission loss, lock/unlock, reboot and separate-network acceptance                                 |
| Release integration                     | Matching development source and migrations 023–028 exist; deployment remains separate                                                                     | Review/merge exact code, validate migrations, rebuild fresh signers and deliberately select rollout/rollback images                     |

### Unattended implementation sequence

Use the completion checklist for current status and the owner's overall order
above. The sequence below retains the full implementation/acceptance contract;
it is not an instruction to rebuild completed integration. Sign-in media,
secure attention, retirement and backend/browser handoff now exist in source.
The next implementation is restart-to-sign-in/progress and setup/readiness;
actual Windows and device acceptance remain open.

1. **Resume ADR 0048 implementation.** Build a separate administrator-enabled machine endpoint, default off, with owner-only sign-in authority and short leases. Keep the boot-presence credential incapable of desktop access. Use the supported interactive-session worker/desktop boundary; never put capture/input in Session 0 or weaken UAC/UIPI/desktop ACLs. Disable files, clipboard, audio, recording and automation in sign-in scope. Terminate that worker on Windows sign-in and obtain fresh ordinary-host authorization.
2. **Validate the machine boundary before treating sign-in as connectable.** Exercise authorization/replay/account isolation, restricted installation/IPC, worker lifetime, desktop switches, local Stop, lease expiry, held-input release and revocation. Preserve current ordinary-session rejection of secure desktops. Run the relevant real-PostgreSQL and native checks; local CI must not install services or reboot this workstation.
3. **Resume device acceptance after development is ready.** The owner supplied a USB Pixel and a Windows SSH endpoint; the November 7 readiness session verified those connections. Testing is now paused by owner direction. Reconfirm device identity and availability when testing resumes; do not probe unrelated endpoints. Cold boot/sign-in/restart/uninstall and true separate-network capture/control/file gates remain open. Use [acceptance-checklist.md](acceptance-checklist.md), [unattended-access.md](unattended-access.md) and the October 29/30 records; compilation or emulator screenshots do not close these gates.
4. **Integrate and release deliberately after evidence review.** Reconcile roadmap PR #113 with this newer implementation branch, resolve current dependency/CI failures against the proposed head, and review the seven Dependabot PRs rather than merging old lockfiles blindly. Apply migrations 023/024 before compatible backend/hosts; update v2-emitting hosts only after the backend, and roll hosts back first. Credential-maintenance backend/data image pins must be explicitly reviewed for a code release. Use the new signers and fresh enrollment. Keep the separate acceptance fixture's STOP marker/services stopped until deliberately scheduled.
5. **Then take up automation.** Review the view-only MCP work in #105, integrate/revalidate it on the current stack and prove a live consented session. Full computer-use input, UI-tree semantics, scoped automation tokens, audit and Beacon Motive integration follow as their own milestone. A green protocol test is not a working Motive integration.

## Work ownership

| Can be implemented and checked independently                                                                                                                                                  | Needs owner/device evidence for completion                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR 0048 endpoint/protocol implementation, authorization/replay/IPC regression checks, build/signing, dependency/CI repair, PR preparation and approved prototype integration with real state | Administrator-approved installation on a designated endpoint; cold boot/sign-in/restart/upgrade/uninstall; actual local Stop/input/media and physical Android/separate-network acceptance |

Source work can proceed before hardware acceptance. Do not label the full unattended milestone complete or install/reboot this active workstation merely because implementation and automated checks pass. Motive/automation integration remains after the unattended milestone.

## Existing product baseline

The last hosted baseline includes attended/trusted/support access, remembered helpers, browser control, local visible consent/Stop, account sign-up and recovery/MFA, account export/deletion, groups/team roles, signed updates, installer/uninstaller, two-way files, consented helper-local recording, dedicated TURN and backup/monitoring jobs. These are implemented features with historical evidence, not a blanket current-device acceptance pass.

Recent development already includes display switching/cursor work, resumed uploads, streamed large browser downloads, temporary support lifecycle, chat/notes/handoff, Wake-on-LAN, trusted restart and opt-in system audio. Their remaining physical/browser/network gates are below. Do not rebuild these features from scratch based on superseded early-milestone notes. Android release packaging and its Downloads entry were merged in [#104](https://github.com/builtbysai/Beacon-Remote/pull/104); old roadmap text saying they were not published was stale.

## Acceptance and follow-up backlog

Keep these tasks visible without starting them inside unattended endpoint work:

| Track                 | Remaining evidence or scope                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real sessions         | Sustained load, sleep/resume, Wi-Fi/cellular changes, direct/forced-relay, disconnect/revocation and local held-input release; retain the historical Android/T-Mobile viewing pass without generalizing it                            |
| Windows install/trust | Administrator trust import on a real test endpoint, SmartScreen, upgrade/rollback, service repair and full uninstall/identity removal with the fresh signer                                                                           |
| Support and accounts  | Real guest code flow, email confirmation/recovery clicks, two-account handoff/chat and the actual web/native panel; offline-then-online disconnect/revoke/uninstall instruction delivery                                              |
| Files                 | Real interrupted-upload resume/hash, large streaming browser download and cancellation; download resume remains unimplemented; browser disk streaming is Chrome/Edge specific                                                         |
| Media/display/audio   | Second-monitor approval and switching, sound judged by ear, native tray notification, constrained/relayed adaptive quality, NVIDIA/AMD/older Intel/no-GPU fallback; existing hardware measurements prove only the tested Intel system |
| Diagnostics           | Complete measured encoder/relay/reconnect data and verify poor-session advice against real measurements                                                                                                                               |
| Android               | Physical phone and Android TV/tablet coverage, real control/rotation/files, audio/multi-touch requirements and outbound phone files; store distribution is separate from signed sideloading                                           |
| UX/accessibility      | Finish approved Assist/Activity/public/auth/settings/download/pairing/viewer/native surfaces with real states; keyboard, screen reader, reduced motion and device layouts beyond historical automated axe results                     |
| Wake-on-LAN           | Wake an actual configured sleeping peer; reporting a NIC or checking a backend route does not prove wake-up                                                                                                                           |
| Self-hosting          | Exercise the existing Compose/bootstrap/backup/restore/update bundle on a real VPS/domain with UDP; local bootstrap evidence is already recorded                                                                                      |

## Later milestones

- Automation: consented MCP/computer-use over the actual session core, semantic UI actions, narrowly scoped revocable tokens and Motive integration. #105 is view-only and unmerged.
- Other hosts: Linux X11/Wayland and Raspberry Pi remain research/implementation work; Android TV installability is distinct from real TV acceptance. macOS/iOS hosting remains out of scope.
- Organisations: computer groups and scoped technician/viewer membership exist; shared administration, organisation-wide permission policy and richer organisation audit do not.
- Performance: measure actual bottlenecks before adding transport/encoder infrastructure. No server media storage or terminal/general privileged-command surface is approved by this roadmap review.

## GitHub checkpoint — November 2, 2026

- No GitHub issues or milestones were listed; nine PRs are open. The owner work is [#113 unattended/automation direction](https://github.com/builtbysai/Beacon-Remote/pull/113) and [#105 view-only MCP](https://github.com/builtbysai/Beacon-Remote/pull/105).
- #113 is docs-only and unmerged; its October 20 CI failed `security` (Cargo vulnerabilities) and `control-plane`, while Android/native passed. It is not the current `codex/unattended-access` implementation. Reconcile the direction without restoring its stale roadmap over this one.
- #105 has green historical security/control-plane/Android/native checks; its own description says it has not been exercised against a live session. It grants no automation control today.
- Dependabot [#106](https://github.com/builtbysai/Beacon-Remote/pull/106)–[#112](https://github.com/builtbysai/Beacon-Remote/pull/112) remain open: rtc, uuid, serde_json, setup-java, pg/types, websocket and globals. #109 was refreshed November 2 UTC. The latest green Actions activity is Dependabot update machinery on main, not CI for the unattended implementation.
- The November 2 review listed 20 default-branch Dependabot alerts. During November 4 cleanup publication, GitHub reported 29 default-branch alerts: two critical, seven high, twelve moderate and eight low. This is a provider warning about main, not a fresh development-branch audit. Re-audit the proposed code/artifacts and review affected packages before device-session deployment; the November 1 branch audit is historical evidence.
- Latest merged product PR is #104, October 14. No GitHub Releases were listed; hosted download publication is tracked separately in deployment documentation.

## Working boundaries

Preserve View on the shared VM/workstation, independent databases and dedicated relay ownership. Keep visible sharing, single-controller authority, local revoke, short leases, the unattended idle limit, fresh-policy reconnect and protected-content handling. Never bypass Windows credentials, secure desktop rules, Android lock/PIN or protected content. Read [security.md](security.md), [architecture.md](architecture.md) and [workspace.md](workspace.md) before implementation. November 1 automated checks and November 2 roadmap inspection do not prove new hardware acceptance or authorize a deployment.
