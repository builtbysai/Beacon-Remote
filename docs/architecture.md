# Architecture and research decisions

## Selected foundation

Use Rust for the Windows endpoint and reusable machine core. TypeScript/Fastify
and PostgreSQL form a small control plane; React/Vite is the browser inventory.
Use mature existing Beacon stack dependencies, with isolated app credentials and
database ownership. Redis, a media server, and microservices have no demonstrated
need. Do not copy Beacon View's large authentication implementation.

The first working slice is identity and presence. Accounts are provisioned by
the operator; password login is isolated and Argon2-hashed. Pairing codes are
random, hashed server-side, five-minute, atomically consumed tokens. Machines
generate Ed25519 private keys locally. The backend verifies signed heartbeat
bytes with timestamps and unique nonces; revocation and updates serialize on the
machine row. Presence expires rather than remaining online after a process dies.

## Desktop path

```text
Browser ── HTTPS/WSS authorization/signaling ── Control plane + PostgreSQL
   │                                               │
   └──── WebRTC video + typed DataChannels ─── Windows session helper
                                                  │
                                      Rust capture/input capability core
                                                  │ secure restricted IPC
                                           Windows service (later)
```

The service will coordinate machine identity, connection, recovery, and updates.
An unprivileged interactive helper will own capture/input and local session
indicators. [Microsoft documents Session 0 isolation](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services);
capture must not live in a service's isolated desktop. Restrict named-pipe IPC to
the service SID and selected interactive user, verify peer identity/session, and
use bounded versioned messages. This boundary is planned; no service/IPC is
pretended to exist in this release.

Start capture with Windows Graphics Capture and explicit monitor selection. Its
[system picker and capture indicator](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture)
fit visible, attended access. Keep DXGI Desktop Duplication as a researched
alternative for later unattended-session support: it supplies dirty/move regions
and separate cursor metadata, but needs explicit consent/indication and
device-loss recovery. Capture owns BGRA snapshots independently of the encoder;
the same source feeds a continuous stream. The primary display comes first.
Per-monitor physical-pixel coordinates and DPI metadata avoid CSS-coordinate
input drift. Track monitor rotation and negative virtual-desktop origins.

For the next media spike, evaluate Media Foundation hardware H.264 encoding with
low-latency settings and browser-compatible profiles, then measured software
fallback. Do not describe webrtc-rs as an encoder: its maintainers explicitly
[require pre-encoded media](https://github.com/orgs/webrtc-rs/discussions/329).
Benchmark native WebRTC integration against libwebrtc before selecting the
shipping transport implementation. No unmeasured codec claim is a final decision.

WebRTC favors direct peers, with Coturn fallback;
[ICE exchanges candidates and TURN supplies relay reachability](https://webrtc.org/getting-started/peer-connections).
Control-plane authorization precedes signaling, TURN credential issuance, or
capture. Relay URLs are configuration, so moving relay infrastructure needs no
endpoint redesign. The VM should not forward ordinary direct desktop video.

Use ordered reliable DataChannels for keys/buttons/session state; use unordered
unreliable pointer moves with sequence rejection and coalescing. Keep dragging
and scroll/state changes reliable. Bound message sizes and text lengths. Release
held input and stop capture on revoke/expiry/disconnect; a local timer must enforce
this even during a network partition. Windows SendInput must respect UIPI and
secure desktop. Reconnect negotiates fresh authorization rather than restoring
a controller implicitly. A reload may recover the original still-active
controller/approval within a bounded transport window; it never revives an ended
grant. See [ADR 0015](decisions/0015-active-viewer-reload-recovery.md).
Start adaptive bitrate from actual RTT/loss/encoder
measurements; neither a screenshot endpoint nor a browser video element defines
the capability core.

## Product references

[Chrome Remote Desktop](https://support.google.com/chrome/answer/1649523) informs
the install/pair/online/click simplicity and explicit support consent.
[RustDesk's server](https://github.com/rustdesk/rustdesk-server) informs separation
of rendezvous and relaying; its protocol is not Beacon Remote's transport.
[MeshCentral's design](https://docs.meshcentral.com/design/) informs endpoint
identity and management boundaries, while advanced management remains deferred.
[BeyondTrust session policies](https://www.beyondtrust.com/products/remote-support/features/session-policies)
inform explicit view/control grants, and its audit concepts inform controller
identity and access history. No vendor code or UI is copied.

The native core has a single-controller monotonic lease and transport-independent
screen/input interfaces. No automation, LLM, or MCP adapter is implemented.
