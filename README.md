# Beacon Remote

Windows computers, accessible from a browser. Part of Beacon, independently
maintained from [Beacon View](https://github.com/builtbysai/Beacon-View).

This development release implements private account login, one-use machine
enrollment, cryptographic machine identity, signed presence, inventory, and
revocation. The native Windows agent runs visibly in a terminal and stores its
private key with user-scoped Windows DPAPI. It installs no service or autostart.
**Desktop streaming and input are not available yet.**

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

Open `http://127.0.0.1:5174`, sign in, choose Add a computer. Run
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
suite refuses targets whose name does not end in `_test`; it clears accounts only
in that target. Without this variable the integration test is explicitly skipped.
CI supplies a disposable PostgreSQL database and builds/tests the native agent on
Windows. No code-signing or installer acceptance is implied by a successful build.

See [architecture](docs/architecture.md), [security](docs/security.md),
[Windows agent](docs/windows-agent.md), and [deployment](docs/deployment.md).
