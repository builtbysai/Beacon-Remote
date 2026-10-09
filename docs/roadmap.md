# Vertical slices

0. Research and architecture: decisions recorded, media stack still needs a native spike.
1. Repository foundation: Rust/TypeScript workspaces, formatting, lint, CI, builds.
2. Identity/presence: isolated account login, one-use pairing, Ed25519/DPAPI,
   signed heartbeat, online/offline inventory, revoke and database audit.
3. Real capture: attended primary display, snapshot interface, measured Windows behavior.
4. WebRTC media: encoded stream, authenticated signaling, direct/forced-relay proof.
5. Input: live authorized lease, pointer/buttons/drag/scroll/keys, local revoke.
6. Resilience: service/helper, reboot/restart, network loss, update/installer foundation.

Completion requires actual checks and machine evidence, not files alone. No
milestone after presence is claimed by this implementation. MCP, AI agents, file
transfer, terminal, recording, extra OS platforms and enterprise management remain
outside this pass.
