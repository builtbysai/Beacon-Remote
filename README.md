# Beacon Remote

**For development handoff:** read [CLAUDE.md](CLAUDE.md),
[the complete Claude handoff](docs/CLAUDE_HANDOFF.md), and
[the active roadmap](docs/roadmap.md). Merging a feature branch does not
release it; production media/control remain disabled until acceptance.


Windows computers, accessible from a browser. Part of Beacon, independently
maintained from [Beacon View](https://github.com/builtbysai/Beacon-View).

This development release implements private account login, one-use machine
enrollment, cryptographic machine identity, signed presence, inventory, and
revocation. The native Windows agent runs visibly in a terminal and stores its
private key with user-scoped Windows DPAPI. It installs no service or autostart.
Attended desktop viewing has local development acceptance. Production media is
disabled pending relay/network validation; mouse and keyboard input are absent.

## Develop

Requirements: Node 22, pnpm 11.9.0, Docker; stable Rust and Microsoft C++ Build
Tools/Windows SDK for native Windows builds. Use a feature branch.

```sh
pnpm install --frozen-lockfile
docker compose -f infrastructure/compose.yaml up -d
```

Set `DATABASE_URL` and `WEB_ORIGIN` using the values in
`apps/backend/.env.example` in your shell (startup does not silently load `.env`).
Then run `pnpm --filter @beacon-remote/backend db:migrate`. Provision a private
account with `REMOTE_ACCOUNT_EMAIL` and `REMOTE_ACCOUNT_PASSWORD` (at least 16
characters) set privately in the process environment, then run
`pnpm --filter @beacon-remote/backend account:create`. Clear those two variables
afterwards. Do not put passwords in command arguments or shared shell history.
There is no public signup or reuse of Beacon View passwords/sessions.

In separate terminals:

```sh
pnpm --filter @beacon-remote/backend dev
pnpm --filter @beacon-remote/web dev
cargo build --workspace
```

Open `http://127.0.0.1:5174`, choose Sign in, then Add a computer. Run
`target/debug/beacon-remote-agent.exe pair` and enter the origin
`http://127.0.0.1:3010`, computer name, and one-use code interactively. Run
`target/debug/beacon-remote-agent.exe run`. It reports a signed heartbeat every
15 seconds; inventory refreshes every five seconds. Stop it with Ctrl+C and
status becomes offline after 45 seconds. Revoke access in inventory to stop
future heartbeats; `forget` removes local identity for deliberate re-enrollment.

## Validate

```sh
pnpm check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --release --locked
```

Create a separate database named `beacon_remote_test` with the local development
PostgreSQL user; set `TEST_DATABASE_URL` to it before `pnpm test`. The integration
suite refuses targets whose name does not end in `_test`; fixture cleanup deletes
only the accounts created by that test. Without this variable integration tests are explicitly skipped.
CI supplies a disposable PostgreSQL database and builds/tests the native agent on
Windows. No code-signing or installer acceptance is implied by a successful build.

For executable acceptance, set `NATIVE_AGENT_PATH` to a CI-built or locally built
Windows agent and `TEST_DATABASE_URL` to a dedicated `_test` database, then run
`pnpm --filter @beacon-remote/backend test:native`. This verifies actual enrollment,
DPAPI persistence, presence, backend restart, offline expiry and revocation.
It runs no desktop capture/input and never replaces the user's paired identity.

The attended capture spike is the separate `beacon-remote-session.exe` helper:
`displays` reports native monitor metadata; `capture-benchmark` asks for local
consent and captures the primary display for ten seconds with a visible border.
It keeps one bounded frame in memory and saves/uploads nothing. Initial real-machine
measurements passed; see [validation and remaining checks](docs/validation.md).

The current media branch adds **attended desktop viewing and a synthetic video test**, gated by a
separate `SESSION_SECRET` (32 random bytes as 64 lowercase hexadecimal characters).
Keep that secret outside source control. An authenticated browser can request a
two-minute view grant; the agent passes it to its matching sibling session helper
through stdin. Synthetic video decoding, browser Stop, logout, expiry and the
visible Windows Stop button passed real-machine acceptance. Desktop grants ask
for explicit local approval before primary-display capture with a Windows border
and visible Stop sharing window. Microphone, recording and input are disabled.
Local desktop viewing acceptance passed; cross-network/relay acceptance remains pending. Production still provides pairing
and presence only. Keep matching agent/helper binaries in the same directory.

The approved product interface adds public Overview, Download, Support and
Security pages plus the authenticated Computers, Sessions, Assist, Activity and
Settings workspace. It uses real account/inventory/history state; unavailable
MFA, recovery, guest support and installer features are explicitly identified.
Light, dark and system appearance are available in the header. To use a separate
local API port, set `REMOTE_API_ORIGIN` before starting Vite; the backend's
`WEB_ORIGIN` must match the browser origin exactly. See the
[interface decision](docs/decisions/0006-approved-product-interface.md).
The default local API target is `http://127.0.0.1:3010`, including WebSocket
forwarding.

The backend relay foundation accepts paired `TURN_URLS` (comma-separated TURN
URLs with explicit ports and `transport=udp` or `transport=tcp`) and `TURN_SECRET`
(at least 32 characters matching Coturn REST authentication), together with
`SESSION_SECRET`. Supply secrets privately in the environment; no `.env` file is
loaded automatically. `turns` requires TCP. Partial configuration fails startup.
An owner's exact-Origin `POST /api/sessions/:id/relay` returns session-deadline
bounded credentials. With TURN configured, browser grants and signed machine
heartbeat responses now carry the same session-bound credentials. The matching
native helper validates and consumes them. `ICE_TRANSPORT_POLICY=relay` forces
relay candidates for acceptance; the default `all` permits direct connections
and relay fallback. Relay-only configuration without TURN fails startup.
Deploy matching helper/backend/web builds together: the old helper rejects the
new grant fields. Native compilation and actual relay acceptance are pending;
production/shared Coturn configuration remains unchanged. See the [delivery roadmap](docs/roadmap.md) and
[relay decision](docs/decisions/0007-session-scoped-relay-credentials.md).

See [architecture](docs/architecture.md), [security](docs/security.md),
[Windows agent](docs/windows-agent.md), and [deployment](docs/deployment.md).
