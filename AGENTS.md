# Beacon Remote

Security, reliability, low latency, and simple setup are the priorities.
Read docs/architecture.md and docs/security.md before substantial changes.
Work on a feature branch. Never commit credentials or `.env` files.
Keep Beacon View independent. Never infer desktop access from camera access.
On the shared workstation, read docs/local-development.md. Remote owns ports
3010/5174/5433 and .remote-dev state; View owns its separate checkout/processes.
Do not modify or clean View's active checkout or registered worktrees for Remote
development. Never reclaim occupied ports by killing their owners. Shared Oracle
Caddy/Coturn changes require coordination and checks of both products.
Use native Rust for Windows endpoint capabilities; capture/input run in the
interactive user session, with visible consent and a local revoke control.
Do not bypass UAC, UIPI, secure desktop, or Session 0 isolation.
Only one authorized controller may inject input. Release held input on revoke,
expiry, disconnect, and shutdown. Protect realistic regressions with the smallest
useful suite; prefer real database and machine boundaries. Report actual checks
and limitations rather than test counts. AI/MCP, file transfer, recording and other
operating systems are roadmap items (see docs/roadmap.md); build each only as its own authorized,
consent-preserving feature.
