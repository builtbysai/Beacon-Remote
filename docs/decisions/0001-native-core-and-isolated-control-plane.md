# ADR 0001: Native Windows capabilities and an isolated control plane

Status: accepted for identity/presence foundation, October 9, 2026.

Use Rust for endpoint identity and reusable machine capabilities. Capture/input
belong to an interactive helper, with a coordinating Windows service added later.
Use TypeScript/Fastify, PostgreSQL and React for the independently deployed
control plane and inventory. Reuse infrastructure patterns from Beacon View but
give Remote separate credentials, database ownership, sessions and grants.

Ed25519 machine credentials avoid transmitting a reusable device secret. Store
private keys with Windows DPAPI; enroll through atomically consumed short-lived
invitations. Use signed replay-protected heartbeats and derived presence before
building media/control. The core enforces one monotonic controller lease and
exposes snapshots separately from continuous media transport.

WebRTC is the planned transport, with direct peers preferred and Coturn fallback.
Native encoder/WebRTC bindings still require measured capture/media spikes. No
automation, MCP, VNC, terminal, extra OS, or privileged input bypass is included.
