# Beacon Remote

Security, reliability, low latency, and simple setup are the priorities.
Read docs/architecture.md and docs/security.md before substantial changes.
Work on a feature branch. Never commit credentials or `.env` files.
Keep Beacon View independent. Never infer desktop access from camera access.
Use native Rust for Windows endpoint capabilities; capture/input run in the
interactive user session, with visible consent and a local revoke control.
Do not bypass UAC, UIPI, secure desktop, or Session 0 isolation.
Only one authorized controller may inject input. Release held input on revoke,
expiry, disconnect, and shutdown. Protect realistic regressions with the smallest
useful suite; prefer real database and machine boundaries. Report actual checks
and limitations rather than test counts. No AI, MCP, file transfer, terminal,
recording, or extra operating systems in this milestone.
