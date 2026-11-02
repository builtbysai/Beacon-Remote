# Beacon Remote development workspace

Beacon Remote is the remote access product. This checkout is D:/Dev/Beacon-Remote. Continue the unattended-access work on its current feature branch; source publication does not establish release acceptance.

## Current development boundary

Implemented work includes local standing owner access, optional presence-only Windows boot service with separate credential/ACL, signed boot availability, shared inventory/session readiness, Android accessibility capture with visible local opt-in/Stop, and fresh-policy restart recovery with signed host process markers. Migrations 023/024 must precede matching backend/client deployment. Existing security, single-controller, lease, local-revoke and protected-desktop boundaries remain required.

Windows initial sign-in-screen control is **unimplemented** (ADR 0048). Actual second-PC service installation, reboot/uninstall and cross-network Windows/Android capture/control acceptance remain open. Do not silently expand this maintenance into a new privileged endpoint or claim full unattended completion. Read `unattended-access.md`, ADRs 0047/0048, security/architecture and the October 29/30 validation records; those records describe earlier checks, not this run's results.

## Run and validate

Use Node 22.13–22.x, pnpm 11.9.0, Rust/MSVC/Windows SDK and the Android SDK/JDK where needed. `pnpm install --frozen-lockfile` installs the reviewed lockfile. Workspace configuration uses hoisted copied dependencies and injected workspace packages without deduplicating them into directory links. Build/typecheck/test/dev scripts refresh injected copies; after editing protocol source, run its typecheck/build workflow or reinstall before consuming it. Regenerate dependencies after changing OS/architecture or toolchains even when the folder itself can be moved.

After shell setup, `pnpm dev:setup`, `pnpm dev:start`, `pnpm dev:status`, `pnpm dev:stop` manage this product's owned local control plane. Reserved API/web/DB ports are 3010/5174/5433; View owns 3000/5173/5432. Ordinary dev keeps media disabled. `REMOTE_DEV_STATE_DIR` defaults to the private root's `remote/local/state`; `REMOTE_ACCEPTANCE_STATE_DIR` selects its retained `remote/acceptance/android` fixture. Do not remove its STOP marker or start a production/acceptance session as a migration check.

`pnpm check` covers format, lint, types, tests and build. Set `TEST_DATABASE_URL` only to a dedicated loopback `_test` database. `scripts/Test-RemoteCi.ps1 -NativeOnly` covers Rust formatting, Clippy, tests and release builds with the installed MSVC environment. Android unit/lint/debug builds are separate. Tests requiring real devices/consent/OS reboot remain manual; compilation and readiness are not media acceptance.

Local credentials are under `remote/local/accounts`; generated supervisor state is `remote/local/state`. Production test login is `remote/production/accounts/test.json` and must not be confused with a local fixture. Current server recovery copies are under `remote/production`; the paused Android fixture is `remote/acceptance/android`; release signing is under `remote/signing`. Signing scripts honor `BEACON_PRIVATE_DIR`. Local copies of server .env files under that folder are recovery material, never local test defaults.

## Workspace and private data

The active Windows workspace is `D:/Dev`. The sibling `D:/Beacon-Secrets` holds real files, with a restricted owner/SYSTEM/Administrators ACL; it is outside all repositories. Never commit its contents. The encrypted independent workstation backup is under `C:/Users/Saiha/Beacon-Backups`, outside the retired `C:/Dev` tree. Its password is in the private root; a current-Windows-user DPAPI-protected recovery copy is beside the backup. That DPAPI copy is not a portable password-manager escrow. Before changing PCs, export the password securely to the owner's credential store and restore-test it on the destination.

Dot-source `. ./scripts/Enter-Workspace.ps1` before local development. If the workspace/private folder is elsewhere, pass `-PrivateRoot <actual-private-folder>` or set `BEACON_PRIVATE_DIR`; never substitute blank/default credentials when a key is missing. This sets paths, not secret values. Keep the repositories independent. Do not confuse dev, disposable tests, hosted acceptance and production.

Development credentials, local deployment-config copies, signing material, SSH keys and retained test profiles were centralized. Installed apps' live identities/browser sessions, Android/Windows credential stores and server secrets retain their required runtime locations by owner choice. DPAPI identities still depend on the original Windows user/machine; moving their files does not make them portable identities.

No production deployment is part of workspace publication. Existing `beacon-oracle` SSH access remains strict-host-key-checked over Tailscale. Server configuration stays root-owned under `/etc/beacon*`; never render secret-bearing Compose/environment output into reports. Shared Oracle ingress and independent View/Remote relays require coordinated changes. Current committed source need not equal the running backend or downloaded native binaries.

The old audit, archive and migration directories have been removed. Use this guide, the roadmap and development-status.md for current work. Never recover occupied ports by stopping their owners. Back up before installs/moves/cleanup and test restoration; GitHub protects pushed source, not ignored secrets, databases or enrolled identities.

Last validated checkpoint: [development-status.md](development-status.md). This records the actual checks and remaining acceptance gates.

## Approved design

The interactive owner-approved visual target is checked in under `design/prototype/`. Its README distinguishes simulated reference behavior from implemented product features. Current screenshots remain under `design/screenshots/`.

The secrets root README.md, CREDENTIALS.csv and ROTATION.md explain credential purposes and staged replacement. REMOTE_LOCAL_ACCOUNTS_DIR selects local fixture accounts; REMOTE_PRODUCTION_LOGIN_FILE selects the explicit production test login. Generators keep ephemeral session links/cookies in local state rather than the stable account file.

For an intentional release, pass the canonical remote/signing/update-private-key.pem to scripts/publish-download.mjs where its key argument is required. Never run make-update-key.mjs over an existing signing key or rotate the pinned key without an update-trust handover.

## Credential rotation checkpoint

On November 1, 2026, the owner-authorized Resend handover replaced the sending key in the production backend and its alert configuration, verified delivered test mail and readiness, and revoked the old provider keys. Both products retained their exact running backend image IDs; no source release or database migration accompanied this refresh. The external private root's ROTATION.md and CREDENTIALS.csv track the remaining credential families.

Credential-only Compose recreation now includes `/etc/beacon-remote/runtime-backend-image.override.yaml`, a root-owned override that pins the existing backend by image ID with pulls disabled. Preserve this pin when refreshing credentials using the current container's Compose labels. For an intentional code release, explicitly select the new image and update or remove the pin rather than carrying an old image into the release. Never print resolved Compose environment or container credentials into logs.

## Current private development credentials

The local `remote_dev` role's password is in `remote/local/database.json` under the private root. `Enter-Workspace.ps1` loads it into the product shell for Compose and the fixed loopback development/test URLs. The supervisor and isolated fixture scripts read that same file; only the password is configurable, never the database host or role. A configured missing/malformed file fails instead of falling back. An ordinary clone without a private file retains its loopback development default. Keep separate shells for View and Remote.

Signing identities were replaced on November 1, 2026 with owner approval for fresh development installs and re-enrollment. Windows update verification pins the replacement Ed25519 key; Android has a fresh signing key. The Windows PFX/certificate/password are new, and `remote/signing/windows/revoked` holds public certificates needed to block retired signers, not private-key archives. Rebuild old installers/APKs before using them; physical device/service acceptance remains separate.

Server credential refreshes retain `/etc/beacon-remote/runtime-data-services-image.override.yaml` for the exact PostgreSQL and backup images. Review it along with the backend image pin during intentional releases. No backend application-code release or schema migration accompanied the credential changes.

The paused Android-viewer acceptance fixture now has an independent rotated database password, account password, session secret and Windows DPAPI identity. Its current recovery files are `remote/acceptance/android/application.env`, `database.dump`, `login.json` and `BeaconRemote/identity.dpapi`; `STOP` remains present. Server configuration is `/etc/beacon-remote/acceptance.env`, and `/etc/beacon-remote/runtime-acceptance-image.override.yaml` resets historical environment overrides to that canonical file while pinning the frozen backend image. Preserve all Compose files in the stopped acceptance container's current labels when deliberately resuming. Historical base-only startup commands do not select this configuration. Both acceptance services remain stopped; do not start them as a credential check.
