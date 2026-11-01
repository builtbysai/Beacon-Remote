# Remote workspace and development handoff

Owner-authorized October 31, 2026 maintenance publishes the previously local unattended-access development and makes the Windows workspace portable. Continue on `codex/unattended-access`; do not treat publication as unattended release acceptance.

## Current development boundary

Implemented work includes local standing owner access, optional presence-only Windows boot service with separate credential/ACL, signed boot availability, shared inventory/session readiness, Android accessibility capture with visible local opt-in/Stop, and fresh-policy restart recovery with signed host process markers. Migrations 023/024 must precede matching backend/client deployment. Existing security, single-controller, lease, local-revoke and protected-desktop boundaries remain required.

Windows initial sign-in-screen control is **unimplemented** (ADR 0048). Actual second-PC service installation, reboot/uninstall and cross-network Windows/Android capture/control acceptance remain open. Do not silently expand this maintenance into a new privileged endpoint or claim full unattended completion. Read `unattended-access.md`, ADRs 0047/0048, security/architecture and the October 29/30 validation records; those records describe earlier checks, not this run's results.

## Run and validate

Use Node 22.13–22.x, pnpm 11.9.0, Rust/MSVC/Windows SDK and the Android SDK/JDK where needed. `pnpm install --frozen-lockfile` installs the reviewed lockfile. Workspace configuration uses hoisted copied dependencies and injected workspace packages without deduplicating them into directory links. Build/typecheck/test/dev scripts refresh injected copies; after editing protocol source, run its typecheck/build workflow or reinstall before consuming it. Regenerate dependencies after changing OS/architecture or toolchains even when the folder itself can be moved.

After shell setup, `pnpm dev:setup`, `pnpm dev:start`, `pnpm dev:status`, `pnpm dev:stop` manage this product's owned local control plane. Reserved API/web/DB ports are 3010/5174/5433; View owns 3000/5173/5432. Ordinary dev keeps media disabled. `REMOTE_DEV_STATE_DIR` defaults to the private root's `remote/development`; `REMOTE_ACCEPTANCE_STATE_DIR` selects its retained `remote/recovery/android-acceptance-20261010` fixture. Do not remove its STOP marker or start a production/acceptance session as a migration check.

`pnpm check` covers format, lint, types, tests and build. Set `TEST_DATABASE_URL` only to a dedicated loopback `_test` database. `scripts/Test-RemoteCi.ps1 -NativeOnly` covers Rust formatting, Clippy, tests and release builds with the installed MSVC environment. Android unit/lint/debug builds are separate. Tests requiring real devices/consent/OS reboot remain manual; compilation and readiness are not media acceptance.

Local credentials: `remote/login.json`; test identities/logins under `remote/development`; retained Oracle/test recovery under `remote/recovery`; Android/code/update signing under `signing-and-deployment/remote-*`. Signing scripts honor `BEACON_PRIVATE_DIR`. Local copies of server .env files under that folder are recovery material, never local test defaults.

## Workspace and private data

The active Windows workspace is `D:/Dev`. The sibling `D:/Beacon-Private` holds real files, with a restricted owner/SYSTEM/Administrators ACL; it is outside all repositories. Never commit its contents. The encrypted independent workstation backup is under `C:/Users/Saiha/Beacon-Backups`, outside the retired `C:/Dev` tree. Its password is in the private root; a current-Windows-user DPAPI-protected recovery copy is beside the backup. That DPAPI copy is not a portable password-manager escrow. Before changing PCs, export the password securely to the owner's credential store and restore-test it on the destination.

Dot-source `. ./scripts/Enter-Workspace.ps1` before local development. If the workspace/private folder is elsewhere, pass `-PrivateRoot <actual-private-folder>` or set `BEACON_PRIVATE_DIR`; never substitute blank/default credentials when a key is missing. This sets paths, not secret values. Keep the repositories independent. Do not confuse dev, disposable tests, hosted acceptance and production.

Development credentials, local deployment-config copies, signing material, SSH keys and retained test profiles were centralized. Installed apps' live identities/browser sessions, Android/Windows credential stores and server secrets retain their required runtime locations by owner choice. DPAPI identities still depend on the original Windows user/machine; moving their files does not make them portable identities.

No production deployment is part of workspace publication. Existing `beacon-oracle` SSH access remains strict-host-key-checked over Tailscale. Server configuration stays root-owned under `/etc/beacon*`; never render secret-bearing Compose/environment output into reports. Shared Oracle ingress and independent View/Remote relays require coordinated changes. Current committed source need not equal the running backend or downloaded native binaries.

The private audit/maintenance directories record inventory, hashes, backup and cleanup evidence. Treat old handoffs and C-path examples as historical unless explicitly updated. Never recover occupied ports by stopping their owners. Back up before installs/moves/cleanup and test restoration; GitHub protects pushed source, not ignored secrets, databases or enrolled identities.

Current maintenance evidence: [workspace-validation-2026-11-01.md](workspace-validation-2026-11-01.md). This records the actual checks and remaining acceptance gates.
