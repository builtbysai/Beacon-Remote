# Beacon Remote development workspace

Beacon Remote is the remote access product. This checkout is D:/Dev/Beacon-Remote. Continue the unattended-access work on its current feature branch; source publication does not establish release acceptance.

## Current checkpoint - November 16, 2026

Continue on `codex/device-acceptance-preparation`. The owner resumed actual tests
with the Pixel and Surfiena available and approved the first local view request.
The isolated backend/web now use `5e8d5c5` with the current schema and a fresh
random test account under the external private preparation directory. Independent
encrypted backup/recovery passed before schema changes. Both production products
were checked unchanged. Acceptance remains bounded to one hour per backend run;
ordinary control is enabled there, while sign-in authority/media stay off.

Surfiena's signed ordinary candidate `a6d114d` is paired in a separate private
on-device profile and runs as the limited signed-in user in session 1. Actual
view-only decoded video, relay connectivity, browser Stop and cleanup passed;
no pixels were saved or input injected. The Pixel update preserved its existing
app identity/data. Wider Windows/Pixel/unattended/lifecycle acceptance stays open.

The owner reported slow initial Online status. First-request long polling was
found to hold that acknowledgement. Startup/recovery source and focused wire
regressions now avoid that wait and the following idle gap. Full native checks,
signing and an actual-device comparison passed: the signed `9d377c6` candidate
acknowledged in 208 ms and the owner confirmed Online was quick. The follow-up
native UI/blank-console candidate `d3bd11c` passed both native configurations and
all four GitHub jobs. The owner confirmed its Start/Stop toggle and no new terminal;
repeat viewing/Stop passed, while media startup and control remain open. Its source and
signed ordinary artifacts are checksum-verified on the VM; media startup and
remaining physical acceptance remain separate. The owner requested core testing
before further layout choices; use the visible isolated viewer for that handoff.
See development status and the completion
checklist; the paused legacy local fixture/identity were not started or moved.

The private state root's `active-acceptance-preparation.txt` locates the current
protected receipts/account. Never print that account's password/session/code.
The maintained `Windows-HostFixture.ps1` uses only Surfiena, pinned artifacts,
versioned binaries, an unchanged on-device profile and limited bounded tasks.
Local approval remains manual. Native public feeds and production gates stay
unchanged. The earlier release checkpoints below are historical.

## Earlier checkpoint - November 15, 2026

Use [completion-checklist.md](completion-checklist.md) and [roadmap.md](roadmap.md).
PRs #115-#117 and #124 are merged. The VM runs tested application source
`5e8d5c5` from #124. All four CI jobs, ARM64 runtime verification, migrations
025-029, quiesced encrypted backup/integrity/isolated recovery and both products'
health/readiness passed. Theme, Downloads, Settings, email, pairing, workspace and
stage-one view-only MCP are published. The larger automation/input/Motive
milestone remains unimplemented.

Android native UI and delayed-response lifecycle fixes passed unit/lint/build
and guarded dummy API/emulator review. Existing-key signed Android and both
Windows candidates from `a6d114d` are staged privately on the VM. Native feeds
remain unchanged; Windows sign-in authority/media remain disabled pending actual
SYSTEM, boot, capture/input, handoff and installation lifecycle acceptance.

The current documentation handoff branch is `codex/publication-receipts`, based
on merged #124. No existing branch was removed. Dependency PRs #118-#123 were
included/closed; no open PR remained at this checkpoint. One moderate lint-only
npm advisory remains outside production runtime dependencies.

The Pixel 7a is ADB-authorized; pinned-key SSH reaches Surfiena with signed-in
session 1. Only inventory/session queries ran. The isolated acceptance backend
still returns 502 and its STOP marker remains present. Matching isolated server/
schema and retained test identity preparation comes before physical tests; do
not substitute production or remove the marker merely because hardware exists.
Full unattended access is not accepted. No installed identity was relocated.

The sections below are historical implementation checkpoints. Their statements
about unpublished work, pending migrations or missing browser integration are
superseded by the current tracker and publication receipts above.

## Historical development boundary

Readiness now has explicit native `signin-media` and backend `SIGNIN_MEDIA_ENABLED`
opt-ins, fresh private worker probes and passive display preflight. Both native
variants and control-plane checks passed; no installed or hosted gate changed.
Native settings separate explicit Enable from non-enabling Repair, which preserves
Disable/backend binding. Candidate packaging verifies compiled capability; it was
not run against dirty source. Bounded crash recovery and protected-service drift/
repair handling are implemented locally; both native CI variants passed November 11. Read-only unpaired Settings rendered/keyboard review passed with the updated
computer-use runtime. Paired/error/narrow/DPI and actual lifecycle/recovery
acceptance remain open. Appearance redesign is in source with browser evidence;
Downloads is also revised locally with synthetic-manifest/browser evidence.
Settings and account/operational email revisions now have local source and
rendered/automated evidence; pairing now has local status/cancellation/completion evidence, with additive
migration 029 pending deployment. The remaining journey review follows. Use the single checklist.

The current host also has separate sign-in settings for setup/repair/status,
Disable and removal, reached from the header/tray. Native CI and read-only
unpaired rendered/keyboard review passed; broader native acceptance remains open.
Local Disable propagates a separately signed lower-only backend invalidation,
including pending/issued handoffs, without making local teardown depend on
network success. This does not raise readiness or establish SYSTEM acceptance.

November 10 current checkpoint: the restart browser journey now enters separate
sign-in access when explicitly ready, then hands off through fresh ordinary
desktop authorization. Synthetic browser restart/Stop/cancellation passed, with
reconnect Cancel reachable above the inventory at narrow and short sizes. No OS
reboot or actual SYSTEM acceptance ran; readiness/public connectability remain
disabled. Setup/readiness, reliable Disable and the remaining design/features
are unfinished. The [completion checklist](completion-checklist.md) supersedes
the historical implementation gaps in dated notes below.

Implemented work includes local standing owner access, optional presence-only Windows boot service with separate credential/ACL, signed boot availability, shared inventory/session readiness, Android accessibility capture with visible local opt-in/Stop, and fresh-policy restart recovery with signed host process markers. Migrations 023/024 must precede matching backend/client deployment. Existing security, single-controller, lease, local-revoke and protected-desktop boundaries remain required.

Windows initial sign-in-screen control is **unfinished** (ADR 0048). Initial native source integration is described below; browser/handoff and actual SYSTEM/device acceptance remain open. Actual second-PC service installation, reboot/uninstall and cross-network Windows/Android capture/control acceptance remain open. Do not claim full unattended completion. Read `unattended-access.md`, ADRs 0047/0048, security/architecture and the October 29/30 validation records; those records describe earlier checks, not this run's results.

November 8: the owner explicitly resumed development before device testing. A
default-off backend sign-in authority registry and scoped leases now exist in
local source with additive migration 025. Native protected installation,
service supervision, scoped worker/IPC lifecycle and offline local disable are
implemented in source, including a guarded worker Disable window. Initial DXGI
readback/native lease scopes now have a separate native media-runner integration.
Rotation/cursor handling exists in source but awaits GPU/device acceptance.
Supervisor lease discovery/revalidation/private delivery now exists in source.
Ephemeral worker public identity/attestation now exists in source with additive
migration 026; apply matching backend schema before v2-emitting native clients.
Backend sign-in signaling now authenticates the attested worker and exact owner
browser, with bounded lifetime/teardown. An initial worker-owned native signaling
client now passes focused loopback/proof/Stop regressions. Initial native H.264/RTC
and scoped input wiring now exist, but no positive SYSTEM/media acceptance has
run. Restart-to-sign-in integration, persistent local Disable failure handling, supported
secure attention and desktop handoff remain unfinished; readiness/public
connectability are still false. Read [signin-authority.md](signin-authority.md) before
continuing that implementation. No production rollout or physical acceptance is
implied. Temporary local credentials and their rotation/removal commands are
documented in [testing.md](testing.md#temporary-local-sign-in).

November 9: strict shared lease responses and a separate browser lease lifecycle
now connect to a scoped signaling/media/input viewer and computer-inspector entry.
Focused regressions and a real-browser synthetic RTC walkthrough have passed;
full-check evidence is in development status. Restart/fresh desktop handoff,
secure attention and persistent Disable failure handling remain unfinished.
No local/native readiness or public connectability was enabled by these checks.

Local Disable save failures now have private, context-bound worker-to-supervisor
forwarding and an in-memory no-relaunch latch; cleanup/persistence confirmation
are separate. Real SYSTEM service, storage-failure and reboot acceptance remain
open. See development status for the exact native check result and limitations.

The supported secure-attention request now connects the sign-in viewer, input
release, bounded worker mailbox and private service IPC. The service revalidates
authority before `SendSAS`, targets only its own worker session and requires
existing Windows policy allowing services. It never writes that policy or uses
UIAccess/synthetic Ctrl+Alt+Delete. Actual SYSTEM delivery remains unaccepted;
fresh desktop handoff/restart entry and the readiness gates remain unfinished.

Ordinary-host handoff binding now has source support: canonical heartbeat v3
signs the user's own host process/console, and optional fresh-policy desktop
grants pin that context for their full lifetime. Legacy heartbeats clear it;
context changes permanently end pinned grants. Migration 027 and the matching
backend must precede v3 hosts. Confirmed sign-in worker teardown/unlock,
browser-bound transition/Stop handling and fresh-grant orchestration remain
unfinished. No readiness gate or physical acceptance was enabled by this work.

Native retirement now has a fresh private terminal acknowledgement and observed
process exit, with separate media/UI completion and a final local Disable flag.
Authority stops while draining; new grants are ignored. Final Disable is latched
before relaunch and retried after normal service shutdown. This is teardown
evidence, not Windows unlock or handoff authorization. Unlock attestation and
the backend/browser transition remain unfinished; see development status for
actual child/pipe checks and the remaining SYSTEM/device gates.

## Run and validate

November 9 integrated handoff now connects confirmed worker retirement and same-
console logged-on/unlocked attestation to a one-use original-browser transition
and fresh ordinary host-bound policy grant. Stop cancels pending/late grants;
successful viewer transfer does not cancel the new ordinary session. Full native
and control-plane checks and a real-browser synthetic RTC transition passed.
Apply migrations 027/028 and matching source together; no rollout or actual
Windows unlock/capture/input acceptance ran. Readiness remains false. Follow
[the completion checklist](completion-checklist.md) for remaining implementation
and gates rather than rebuilding dated foundations above.

Use Node 22.13–22.x, pnpm 11.9.0, Rust/MSVC/Windows SDK and the Android SDK/JDK where needed. `pnpm install --frozen-lockfile` installs the reviewed lockfile. Workspace configuration uses hoisted copied dependencies and injected workspace packages without deduplicating them into directory links. Build/typecheck/test/dev scripts refresh injected copies; after editing protocol source, run its typecheck/build workflow or reinstall before consuming it. Regenerate dependencies after changing OS/architecture or toolchains even when the folder itself can be moved.

After shell setup, `pnpm dev:setup`, `pnpm dev:start`, `pnpm dev:status`, `pnpm dev:stop` manage this product's owned local control plane. Reserved API/web/DB ports are 3010/5174/5433; View owns 3000/5173/5432. Ordinary dev keeps media disabled. `REMOTE_DEV_STATE_DIR` defaults to the private root's `remote/local/state`; `REMOTE_ACCEPTANCE_STATE_DIR` selects its retained `remote/acceptance/android` fixture. Do not remove its STOP marker or start a production/acceptance session as a migration check.

`pnpm check` covers format, lint, types, tests and build. Set `TEST_DATABASE_URL` only to a dedicated loopback `_test` database. `scripts/Test-RemoteCi.ps1 -NativeOnly` covers Rust formatting, Clippy, tests and release builds with the installed MSVC environment. Android unit/lint/debug builds are separate. Tests requiring real devices/consent/OS reboot remain manual; compilation and readiness are not media acceptance.

Local credentials are under `remote/local/accounts`; generated supervisor state is `remote/local/state`. Production test login is `remote/production/accounts/test.json` and must not be confused with a local fixture. Current server recovery copies are under `remote/production`; the paused Android fixture is `remote/acceptance/android`; release signing is under `remote/signing`. Signing scripts honor `BEACON_PRIVATE_DIR`. Local copies of server .env files under that folder are recovery material, never local test defaults.

November 8 reset supersedes the old account-file references: all old Remote
accounts were deleted from the four databases, and obsolete local/production/
acceptance login records and canonical dumps were removed after encrypted
recovery. Only a fresh local `temporary-development.json` has been created.
Do not fabricate a replacement for the removed production login file or restore
old enrollments. Server/signing/SSH secrets and installed runtime identities were
preserved. See [the reset record](account-reset.md) for historical-copy retention
and remaining device checks.

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

On November 1, 2026, the owner-authorized Resend handover replaced the sending key in the production backend and its alert configuration, verified delivered test mail and readiness, and revoked the old provider keys. Both products retained their exact running backend image IDs; no source release or database migration accompanied this refresh. The external private root's ROTATION.md and CREDENTIALS.csv record completion of all inventoried credential families.

Credential-only Compose recreation now includes `/etc/beacon-remote/runtime-backend-image.override.yaml`, a root-owned override that pins the existing backend by image ID with pulls disabled. Preserve this pin when refreshing credentials using the current container's Compose labels. For an intentional code release, explicitly select the new image and update or remove the pin rather than carrying an old image into the release. Never print resolved Compose environment or container credentials into logs.

## Current private development credentials

The local `remote_dev` role's password is in `remote/local/database.json` under the private root. `Enter-Workspace.ps1` loads it into the product shell for Compose and the fixed loopback development/test URLs. The supervisor and isolated fixture scripts read that same file; only the password is configurable, never the database host or role. A configured missing/malformed file fails instead of falling back. An ordinary clone without a private file retains its loopback development default. Keep separate shells for View and Remote.

Signing identities were replaced on November 1, 2026 with owner approval for fresh development installs and re-enrollment. Windows update verification pins the replacement Ed25519 key; Android has a fresh signing key. The Windows PFX/certificate/password are new, and `remote/signing/windows/revoked` holds public certificates needed to block retired signers, not private-key archives. Rebuild old installers/APKs before using them; physical device/service acceptance remains separate.

Server credential refreshes retain `/etc/beacon-remote/runtime-data-services-image.override.yaml` for the exact PostgreSQL and backup images. Review it along with the backend image pin during intentional releases. No backend application-code release or schema migration accompanied the credential changes.

The paused Android-viewer acceptance fixture now has an independent rotated database password, account password, session secret and Windows DPAPI identity. Its current recovery files are `remote/acceptance/android/application.env`, `database.dump`, `login.json` and `BeaconRemote/identity.dpapi`; `STOP` remains present. Server configuration is `/etc/beacon-remote/acceptance.env`, and `/etc/beacon-remote/runtime-acceptance-image.override.yaml` resets historical environment overrides to that canonical file while pinning the frozen backend image. Preserve all Compose files in the stopped acceptance container's current labels when deliberately resuming. Historical base-only startup commands do not select this configuration. Both acceptance services remain stopped; do not start them as a credential check.
