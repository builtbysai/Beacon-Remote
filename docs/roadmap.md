# Beacon Remote delivery roadmap

Reviewed November 2, 2026 against the checkout, GitHub issues/PRs/branches and Actions. This is the current scope and execution order; superseded milestone tables are in Git history. Implementation, automated checks, physical acceptance and hosted release are separate facts.

## Where development stopped

The active branch is `codex/unattended-access` at `5f019c4`, eight pushed commits ahead of `main` (`eb1ea99a`) before this documentation review. There is no implementation PR for this branch. The last recorded hosted web/download release is `eb1ea99a`, with backend source `2721aae` (October 29 deployment check). November credential maintenance retained exact running images: it did not release the unattended code or apply migrations 023/024.

The owner has no external production users and approved fresh signing identities, installation and re-enrollment. The inventoried credentials, database consumers, backup passwords and signing material were refreshed November 1; cleanup finished November 2. Do not repeat rotation as a product milestone. Source public update pins are new; old downloaded installers/APKs are not compatible recovery baselines for new signing trust.

Fresh local artifacts in `dist/` are `BeaconRemoteSetup-5f019c49.exe`, the matching `BeaconRemoteDevelopment-5f019c49` folder/ZIP/trust folder, and `BeaconRemoteHost-4e7a39fc.apk`. Native CI, exact-commit payload hashes, timestamped Windows self-signing and the APK signature were checked. The Android artifact's earlier commit differs by the subsequent Windows toolchain helper fix. These are development artifacts, not proof of installation, real input/media acceptance or a hosted release. The owner-approved UI reference is [design/prototype](../design/prototype/README.md); its simulated flows are not product implementation.

## Active milestone: finish unattended owner access

The owner's October 20 direction is in [PR #113](https://github.com/builtbysai/Beacon-Remote/pull/113). The October 30 clarification explicitly requires optional boot startup, control at the initial Windows sign-in screen and fresh-policy reconnect after restart. Signed-in-only access does not complete this milestone. [ADR 0047](decisions/0047-unattended-owner-access.md), [ADR 0048](decisions/0048-boot-login-and-restart.md) and [unattended-access.md](unattended-access.md) define the boundary.

| Area                                    | Current evidence                                                                                                                                          | Remaining work                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Windows standing owner access           | Local opt-in, owner control/files, sign-in startup, visible Pause/Stop and local revocation are implemented; process/database fixtures passed             | Real installed-host and cross-network acceptance                                                                                        |
| Optional boot presence                  | Separate presence-only credential, restricted install/ACL checks, explicit locked/signed-out readiness and service-aware forget/uninstall are implemented | Administrator-approved install/repair/reboot/uninstall on a designated test PC                                                          |
| Windows initial sign-in capture/control | ADR 0048 design only; the current service explicitly has no capture/input/process-launch authority                                                        | Implement the separate endpoint, scoped authorization, interactive worker and desktop handoff; then perform OS-level acceptance         |
| Restart recovery                        | Signed host-process marker, bounded wait and fresh authorization implemented; migration 024 and local fixtures checked                                    | Actual Windows restart/fast restart, cancellation, console switch and end-to-end handoff; a host-process restart is not proof of reboot |
| Android 11+ unattended                  | Local standing opt-in, accessibility screenshots, owner-policy intersection, notifications and Stop implemented; unit/build/emulator evidence recorded    | Physical phone, protected content, permission loss, lock/unlock, reboot and separate-network acceptance                                 |
| Release integration                     | Compatible backend/client source and migrations 023/024 exist                                                                                             | Review/merge exact code, validate migrations, rebuild fresh signers and deliberately select rollout/rollback images                     |

### Next steps, in order

1. **Resume ADR 0048 implementation.** Build a separate administrator-enabled machine endpoint, default off, with owner-only sign-in authority and short leases. Keep the boot-presence credential incapable of desktop access. Use the supported interactive-session worker/desktop boundary; never put capture/input in Session 0 or weaken UAC/UIPI/desktop ACLs. Disable files, clipboard, audio, recording and automation in sign-in scope. Terminate that worker on Windows sign-in and obtain fresh ordinary-host authorization.
2. **Validate the machine boundary before treating sign-in as connectable.** Exercise authorization/replay/account isolation, restricted installation/IPC, worker lifetime, desktop switches, local Stop, lease expiry, held-input release and revocation. Preserve current ordinary-session rejection of secure desktops. Run the relevant real-PostgreSQL and native checks; local CI must not install services or reboot this workstation.
3. **Arrange the missing device acceptance.** The current available inventory is this Windows laptop and the Oracle Linux VM; the owner confirmed there is no second Windows laptop. Do not assume the retired lab SSH fixture is usable or probe Muse. A designated Windows test endpoint and physical Android phone are external dependencies for cold boot/sign-in/restart/uninstall and true separate-network capture/control/file acceptance. Use [acceptance-checklist.md](acceptance-checklist.md), [unattended-access.md](unattended-access.md) and the October 29/30 records; compilation or emulator screenshots do not close these gates.
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
