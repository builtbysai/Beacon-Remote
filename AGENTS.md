# Beacon Remote

Security, reliability, low latency, and simple setup are the priorities.
Read docs/architecture.md and docs/security.md before substantial changes.
Work on a feature branch. Never commit credentials or `.env` files.
Keep Beacon View independent. Never infer desktop access from camera access.
On the shared workstation, read docs/local-development.md. Remote owns ports
3010/5174/5433 and its external private development state (docs/workspace.md);
View owns its separate checkout/processes.
Do not modify or clean View's active checkout or registered worktrees for Remote
development. Never reclaim occupied ports by killing their owners. Shared Oracle
Caddy/Coturn changes require coordination and checks of both products.
Use native Rust for Windows endpoint capabilities; capture/input run in the
interactive user session, with visible consent and a local revoke control.
Do not bypass UAC, UIPI, secure desktop, or Session 0 isolation.
Only one authorized controller may inject input. Release held input on revoke,
expiry, disconnect, and shutdown. Protect realistic regressions with the smallest
useful suite; prefer real database and machine boundaries. Report actual checks
and limitations rather than test counts. Capabilities beyond viewing and control (file transfer,
recording, sound, shared folders, printing, AI/MCP control, Windows sign-in access) each sit behind
their own explicit, revocable permission; new ones (other operating systems, peripherals) follow
docs/roadmap.md and are built only as their own authorized, consent-preserving feature.
Start from docs/roadmap.md and the latest docs/handoff-*.md; docs/history holds dated evidence only.
