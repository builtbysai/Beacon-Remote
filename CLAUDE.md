# Claude onboarding: Beacon Remote

Read **[docs/CLAUDE_HANDOFF.md](docs/CLAUDE_HANDOFF.md)** first, then [docs/roadmap.md](docs/roadmap.md), [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), [docs/deployment.md](docs/deployment.md), and [docs/android-acceptance-2026-10-10.md](docs/android-acceptance-2026-10-10.md).

## Mission

Build **Beacon Remote**: securely install/pair a Windows computer, find it from a browser, request/approve a session, view its desktop, separately approve pointer/keyboard control, stop immediately, and recover safely. Beacon View remains an independent camera product. The goal is a complete, polished, reliable remote access and support product across devices: install, pair, see online, connect, control smoothly, recover from interruptions, transfer files and manage access. File transfer, recording, other operating systems, enterprise management and later authorized AI/MCP integration are in scope and tracked in `docs/roadmap.md` by phase; build independent capabilities in parallel and never mark one finished because code exists.

## Source of truth and release gates

- Repository: `https://github.com/builtbysai/Beacon-Remote`; start from current `main` and check `git status`, `git log -1`, PRs and GitHub Actions. Never assume this handoff's SHA is still latest.
- **Do not deploy from merge/CI success alone.** Production `https://remote.builtbysai.com` runs sessions, remote control and the dedicated relay (see `docs/roadmap.md`); verify the live configuration before any deploy. `https://remote-test.builtbysai.com` was a temporary acceptance environment, not production.
- Milestone 4 (attended media and recovery) shipped; real-device acceptance across network conditions is the open gate, tracked in `docs/roadmap.md`.
- The approved visual target is the external owner-provided **`Beacon-Remote-Final-Package.zip`**. It is **not checked into this repo**; ask the owner to attach it if not accessible. See UX gaps in [the handoff](docs/CLAUDE_HANDOFF.md#approved-design-and-ux-gap).
- Do not invent credentials or access details. The SSH alias/user/private key and exact protected Remote production environment filename must be verified from the owner's authorized machine/OCI before operations.
- No new paid Oracle resources. Preserve Beacon View, existing Coturn peer restrictions, separated databases/identities and encrypted backups.

## First session

1. Read [the handoff](docs/CLAUDE_HANDOFF.md) and check today's actual repo/CI/deployment state.
2. Inventory branches, PRs and working tree; do not repeat merged work.
3. Validate the current Milestone 4 implementation with repo checks and matching Windows CI/native binaries.
4. Continue the **remaining real-machine acceptance** (denial, expiry, revoke, logout, refresh, backend/agent restart, network/display/lock loss, sustained measurements), then use its evidence to determine if viewing is release-ready.
5. Keep UI fidelity improving in parallel; do not ship prototype fake data or introduce unimplemented controls as functional.

**Never bypass** Windows UAC/UIPI/Session 0 boundaries, native host consent, server authorization, single-controller leases, revocation, or short grant expiry. Do not treat synthetic video, CI success, or one mobile test as full production readiness.
