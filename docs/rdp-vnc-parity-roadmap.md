# RDP/VNC parity and beyond: delivery roadmap

Owner-requested scope, audited November 17, 2026 against `1afcc9e` and the
current device receipts. This is a development plan, not a parity/release claim.
The supplied `beacon-remote-vs-rdp-gaps.md` is an input to this audit; its embedded
fix instructions and historical deployment statements are not fresh evidence or
permission to enable production gates. Keep [remaining testing](testing-remaining.md)
and [the handoff](next-agent-handoff.md) beside this plan.

## Target and comparison rules

Deliver a dependable everyday remote computer, attended support, and scoped agent
control, with the useful capabilities of modern RDP clients and mature VNC products.
Do not call Beacon better until comparative acceptance demonstrates it. Compare
the same tasks, hardware, OS edition, display arrangement and network conditions.
Report unsupported combinations explicitly instead of silently dropping features.

RDP, Windows App, RDS/AVD and VNC vendor products are different baselines. Features
vary with host/client/platform/policy. Windows Home cannot host Microsoft's RDP;
Surfiena is Home, so use an authorized Pro/Enterprise or licensed Server reference
for RDP comparisons. RFB is a framebuffer/input protocol; vendor extensions add
capabilities. See [Microsoft host support](https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remotepc/remote-desktop-allow-access),
[client feature matrix](https://learn.microsoft.com/en-us/windows-app/compare-platforms-features),
[RFB specification](https://www.rfc-editor.org/rfc/rfc6143.html) and
[RealVNC product features](https://www.realvnc.com/en/connect/features/).

Some parity work needs a native companion or broker, rather than only a browser.
That is an architectural proposal to evaluate, not permission to bypass browser
or OS security. RemoteApp, independent logon sessions and multi-user hosting need
an explicit implementation or licensed RDP/RDS interoperability plan; a shared
console stream is not an independent persistent OS session. Never patch Windows
session/licensing restrictions to claim equivalence.

Feature parity does not automatically mean RDP/RFB wire-protocol compatibility.
If existing clients/servers must interoperate, specify and test an authenticated
gateway separately, with its licensing and credential boundaries. Retain view-only
mode and explicit control transfer in every new client.

## Corrections to every supplied gap

| Supplied claim                                      | Current finding                                                                                                                                                                                                        | Remaining work                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Input is dev-only and production control is off  | Stale as a blanket claim: hosted alpha ordinary control is documented enabled; isolated real Pixel touch/typing passed. Windows ordinary input exists. Windows sign-in authority/media are separate default-off gates. | Verify actual production flags, installed endpoint readiness and signed release; Windows physical control/input release is still open.                                |
| 2. No unattended access; work only on an old branch | Signed-in Windows and unlocked Android standing access exist. `origin/codex/unattended-access` is an ancestor of current HEAD. Actual Pixel prompt-free owner connections/control passed.                              | Complete Windows boot/sign-in/secure attention/handoff and Android lifecycle acceptance. Android lock/protected content remain OS boundaries.                         |
| 3. Nothing installed                                | Too broad: Pixel has the same-signer `1afcc9e` update; Surfiena used a paired, bounded signed fixture.                                                                                                                 | Ordinary installed Windows service/startup/upgrade/recovery acceptance and a normal owner installation are unfinished. A fixture is not a released installation.      |
| 4. Clipboard excluded everywhere                    | View-only and sign-in scopes deliberately exclude it. Ordinary Windows control already reads bounded remote text; viewer paste sends typed input.                                                                      | True bidirectional clipboard synchronization, Unicode/HTML/images/files, consent, races/size limits and agent tools. Typing paste is not clipboard redirection.       |
| 5. File transfer unverified                         | Windows inbound/outbound/resume implementations exist. Actual Pixel received a 3 MiB file with identical SHA256 on November 17.                                                                                        | Windows physical transfers/resume; Android cancellation/refusal/interruption/duplicates/storage-full and outbound/resume gaps. Drive mapping is separate and missing. |
| 6. Single display/no touch                          | Display selection and mobile touch/keyboard code exist; Pixel touch/typing passed. The live rotation disconnect was traced to clipboard/display routing and fixed in `c22dc2f`.                                        | Windows multi-display/DPI/Unicode/IME/pen/multi-touch acceptance and richer input; secure desktop is a separate supported authority.                                  |
| 7. No reconnect/persistence                         | Ordinary reload/reconnect and fresh-policy restart recovery exist; sign-in grants intentionally do not inherit that authority.                                                                                         | Physical flap/reload/restart/expiry tests; persistent independent OS sessions, disconnected-session reattach and multi-user semantics remain a separate gap.          |
| 8. Hardware/adaptive video only on branches         | Implementations are in `apps/windows-session/src/encoder.rs` and quality paths. Old branch names are not proof of absence.                                                                                             | GPU/driver matrix, headless/lock recovery, CPU/RAM/bandwidth and input-to-photon benchmarks against RDP/VNC.                                                          |
| 9. No audio                                         | Ordinary attended Windows output-loopback audio exists (ADR 0044), separately approved.                                                                                                                                | Physical listening/latency tests; trusted-owner sound setting, microphone redirection, two-way voice, device selection and Android audio.                             |
| 10. No Wake-on-LAN                                  | Neighbor-assisted wake queue/packet path and tests exist (ADR 0042). Wake is a hardware/network workflow, not a guaranteed property of an RDP connection.                                                              | Actual wired/wireless sleep/firmware cases, no-neighbor UX, always-on gateway and neighbor opt-out policy.                                                            |
| 11. Agent surface is view-only                      | Correct. MCP offers inventory, request view session, screenshot, status and Stop. Browser test automation is not shipped MCP input.                                                                                    | Revocable agent credentials, scoped pointer/keyboard/clipboard/files, semantic UI, cancellation, audit and Motive integration.                                        |

Additional corrections: RDP has TLS/CredSSP/NLA security, so it is inaccurate to
say it has no authenticated/security foundation. Beacon's signed machine presence
and enrollment are different mechanisms, not proof of superiority. RemoteFX vGPU
was removed; benchmark supported contemporary graphics paths instead. References:
[RDP security](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/592a0337-dc91-4de3-a901-e1829665291d),
[RemoteFX removal](https://support.microsoft.com/en-us/servicing/os/windows/2020/07/kb4570006-update-to-disable-and-remove-the-remotefx-vgpu-component-in-windows).

## Ordered implementation backlog

November 17 continuation: P0-1's moderate minimatch issue is resolved by the
supported TypeScript-ESLint 8.73.0 update (`754f585`); high picomatch still blocks
full audit with no published patch. Viewer input-release regressions and fixes
(`be832b2`, `2fd40a3`) prevent delayed clipboard typing after release, stale
modifiers and held Enter/Tab when replacing a paced paste.
Local web checks pass; P0-2 still requires physical Surfiena control/Stop/release.
See the updated handoff for the next complete test unit. No new runtime/device
state was changed or inspected in this source continuation.

Status: **acceptance** means source exists but the stated use case is not yet
accepted; **partial** means material implementation remains; **missing** means no
working implementation was identified. A later discovery changes the status,
not the exit criteria. All new scopes need endpoint-local enforcement and revoke.

| ID / order | Capability and status                               | Deliverable and completion evidence                                                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1       | Release consistency — partial                       | Resolve dependency audit without hiding vulnerable dependencies; review draft PR #126; align source, schemas, signed candidates, test runtime and rollback. Publish feeds only after device gates.                                                                                        |
| P0-2       | Core remote computer — acceptance                   | Normal Windows install/pair/start, actual input/video/Stop, multi-minute work, control release, no helper consoles/blinking; complete boot/sign-in/SYSTEM worker/secure attention/desktop handoff and recovery with admin setup.                                                          |
| P0-3       | Android dependable host — partial                   | Finish permission recovery, unattended lifecycle, capture/input coordinate changes, lock, network flaps, background/screen-off and upgrade. `c22dc2f` fixes rotation routing; `1afcc9e` fixes stale revoked-access status. Keep platform limits visible.                                  |
| P0-4       | Permission escalation during a connection — partial | Request control/files/audio/recording from an existing view session. Fresh local approval for broader access; keep one controller and release old input; timeout/deny/cancel/reconnect cases.                                                                                             |
| P1-1       | Agent control and handoff — missing beyond viewing  | Per-device/time/tool scopes, short-lived revocable agent credentials, pointer/keyboard/text/clipboard/files/status/Stop, idempotent bounded commands, controller transfer, semantic UI trees and Motive adapter. Real agent completes a safe task and cannot act after revoke.            |
| P1-2       | Clipboard — partial                                 | Bidirectional text/Unicode first, then HTML/images/files, ownership/conflict handling, format negotiation and explicit policy. Protect passwords/private formats, size budgets and loops; test actual cross-app copies.                                                                   |
| P1-3       | File workflows — partial                            | Reliable two-way browse/send/download, directory/batch transfer, streaming/resume/integrity, overwrite/conflict/cancel/storage limits, Android outbound and resume. Preserve sandbox/path/symlink boundaries.                                                                             |
| P1-4       | Drive/folder redirection — missing                  | Map an explicitly selected local folder into the remote workflow with revocable read/write rights and filesystem semantics. Test locks, rename, large/sparse files, disconnect recovery and permission boundaries. A download button is not drive mapping.                                |
| P1-5       | Full input fidelity — partial                       | Layouts/dead keys/AltGr/IME/composition/Unicode, shortcuts, held-key release, high-resolution wheel, relative mouse, touch/pen/pressure/multi-touch, accessibility navigation and mobile keyboard. Test real apps on supported platforms.                                                 |
| P1-6       | Display workstation — partial                       | Multi-monitor selection and simultaneous multi-monitor layouts, per-monitor DPI, hotplug, resize, virtual/headless displays, ultrawide/4K/high refresh, cursor accuracy, color/HDR policy. Distinguish switching one screen from simultaneous multi-monitor parity.                       |
| P1-7       | Reconnect and durable work — partial                | Reload, network change, sleep/resume and host restart recovery under unchanged policy; preserve application state and explain when new approval is required. Design disconnected/independent user sessions separately from replaceable media transports.                                  |
| P1-8       | Performance — partial                               | Hardware/software fallback diagnostics, adaptive quality, explicit quality controls, low-motion/text clarity and video handling. Capture percentile startup/input latency, FPS, encode cost, CPU/RAM, bandwidth and reconnect time against the selected RDP/VNC reference.                |
| P1-9       | Sound and collaboration — partial                   | Verify output audio; add separately approved trusted sound, input microphone, two-way voice and device switching; validate mute/Pause/Stop/recording boundaries. Chat/handoff baseline exists; test delivery/history and operator transfer.                                               |
| P2-1       | Printing — missing                                  | Native companion/broker print redirection, printer discovery/selection, job lifecycle/cancel and isolation. No silent installation or broad spooler access.                                                                                                                               |
| P2-2       | Cameras and multimedia devices — missing            | Explicit webcam/video-capture redirection, device selection, contention, unplug/replug, codec/bandwidth and privacy indicators.                                                                                                                                                           |
| P2-3       | USB and specialist peripherals — missing            | Supported-device policy and authenticated companion transport for USB, smart-card/authenticator, serial/COM and applicable peripheral categories. Start with a tested allow list; never market arbitrary USB passthrough without evidence.                                                |
| P2-4       | Credentials and enterprise login — partial/missing  | Separate Beacon account MFA from remote OS login. Evaluate SSO/passkeys/OIDC/SAML/directory integration, smart-card/WebAuthn redirection and Remote Credential Guard-like credential minimization. Do not export OS credentials into logs or agent prompts.                               |
| P2-5       | Independent sessions/RemoteApp — missing            | Decide native implementation versus licensed RDP/RDS gateway interoperability. Define console sharing, per-user desktops, multiple sessions, application publishing, broker/session selection, disconnect/logoff and licensing. Verify simultaneous users without Windows patches.        |
| P2-6       | Fleet administration — partial                      | Organization roles/policy inheritance, per-scope access, scheduled/JIT access, approvals, deploy/update/rollback, device health, audit export/retention and session ownership. Add explicitly scoped terminal/process/service management as a separate privileged capability.             |
| P2-7       | Platform reach — partial/missing                    | Windows release matrix; Linux X11/Wayland and Raspberry Pi host/package/service; macOS host with native OS permissions; supported web/mobile/native clients. Define iOS viewing/hosting limitations honestly; Android tablet/TV actual acceptance.                                        |
| P2-8       | Network autonomy — partial                          | Direct/relay/separate networks/IPv4/IPv6/proxy/firewall tests; dependable TURN sizing, self-hosted/private-network/offline-LAN modes, relay regions and capacity controls. Local discovery and optional authenticated RDP/VNC gateways are separate features.                             |
| P2-9       | Power and maintenance — partial                     | Physical WoL with neighbor/gateway policy, supported sleep/hibernate/reboot/shutdown/restart-to-reconnect and OS update recovery. Never imply arbitrary powered-off/Wi-Fi wake is guaranteed.                                                                                             |
| P3-1       | Trust above transport — missing/partial             | Independently authenticated peer identities and an explicit E2E threat model, key changes/recovery, signed supply chain, public-trust signing, abuse protections, redacted diagnostics and security review. WebRTC encryption alone is not a malicious-signaling-server defense.          |
| P3-2       | Better support experience — partial                 | Fast simple setup, accurate readiness/reason codes, contextual permissions, accessible minimal UI, keyboard/screen-reader/zoom/touch/DPI, local revoke, recording consent, annotations/pointer cues and clear operator handoff. Preserve the completed theme/download/settings/mail work. |
| P3-3       | Better agent experience — missing                   | Semantic targets plus screenshot grounding, bounded task scopes, action receipts, secret-safe interaction, user takeover/emergency Stop, replay-safe resumption and deterministic audit. Demonstrate recovery from failure without gaining authority.                                     |

Resource-redirection categories are grounded in Microsoft's
[redirection specification](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdsod/63e29ab5-6c33-4748-a78f-2f65789f3a5e)
and [resource support documentation](https://learn.microsoft.com/en-us/azure/virtual-desktop/redirection-remote-desktop-protocol).
The implementation details and ordering above are Beacon design proposals.

## Execution and release gates

VNC/support-specific additions also remain explicit backlog items: multiple
authorized observers with exactly one controller, join/leave and controller
handoff audit, an approved privacy mode that blanks the physical monitor or
suppresses local input only on supported OS paths, and an always-reachable local
emergency revoke. These are not implied by one live session or ordinary recording.
Implement and test them under P2-5/P3-2; never hide sharing or disable the owner's
ability to recover control. Verify transfer drag/drop, remote-cursor rendering,
connection profiles and local/direct discovery rather than assuming browser
scaling or computer groups supply every mature VNC workflow.

1. Close P0 with coherent physical acceptance and a signed rollback-capable release.
2. Deliver agent control, richer clipboard/files/input/displays and reconnect as
   separate complete milestones. Do not restart already implemented features from
   historical branches. Four older file/encoder/adaptive branch heads are not
   ancestors of HEAD; compare actual patches before treating them as pending or
   deleting them. Current code already contains these feature families.
3. Specify companion/broker boundaries and complete the peripheral/session/platform
   milestones. A feature cannot be quietly declared out of scope to claim full parity.
4. Run the comparison matrix. Agree measurable thresholds before testing; at least
   beat the reference on setup, agent workflow and recovery while reporting any
   latency/quality/resource regression. No unsupported blanket “faster/better” claim.
5. Finish release security, lifecycle, UX/accessibility and documentation. Rotate/
   delete the temporary account only after remaining acceptance is complete;
   preserve backup/provider-retention accounting and other Beacon products.

Every completed milestone must include shipped code, relevant regression checks,
real end-to-end action, revoke/Stop and teardown evidence, device/build/network
identity, known limitations and a committed receipt. Builds and health endpoints
alone do not close a device feature. Keep historical evidence, but replace stale
current summaries when a newer result supersedes them.

## Owner decisions, November 19, 2026

These are decisions from the owner. Each is still to be designed and reviewed before code, and the owner's approval does not replace that review.

- **Clipboard writing:** approved in both directions, each gated by a local approval on the device. ADR 0021 forbids clipboard writing today and must be revised before any code.
- **Native session attach:** approved to add a privileged SYSTEM service. It must keep the Session 0, UAC and UIPI boundaries and needs a separate security review before implementation.
- **USB forwarding and microphone redirection:** both approved. Each needs hardware to test, and each needs its own consent and revocation rules.
