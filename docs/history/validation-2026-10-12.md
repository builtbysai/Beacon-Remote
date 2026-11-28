# October 12 local validation and manual production rollout

The owner authorized local checks and manual deployment while GitHub Actions
cannot start jobs. Exact deployed Beacon Remote source is
`74a4e6e4d6573836c3da6dfc766b4c84c90c02e7` on
`codex/remote-development`. Production remains a private alpha with media
disabled. Beacon View was not rebuilt or redeployed.

## Local validation

`scripts/Test-RemoteCi.ps1 -ControlPlaneOnly` passed against Remote's isolated
local PostgreSQL test database: frozen dependency install, Prettier, ESLint,
TypeScript, all ten backend integration tests, web/backend builds, production
dependency audit, and Rust formatting. The Windows PC has no MSVC linker, so
native Clippy, native tests, and native release build did not run locally.
There were no native source changes in this branch relative to `origin/main`.
Chrome visual review covered the authenticated workspace and public landing at
phone and desktop widths, with dark theme and navigation checks. Live desktop
acceptance was not repeated; local media was disabled.

The latest GitHub run for the deployed commit had zero executed steps. GitHub
reported account payment/spending restriction before both jobs started; no CI
pass is claimed.

## Manual rollout

Before replacement, the running release was `4ea7ad97eac00ca6b8b33f7c168aa34e5a2f4d28`.
The existing encrypted Remote backup completed, Restic integrity passed, and
an isolated separate-database restore passed schema/aggregate verification.
Previous backend/web image IDs were tagged `rollback-4ea7ad9`. The exact Git
archive SHA-256 matched locally and on Oracle before extraction into a new
release directory. All Remote application and operations images built there.

The previous backend stopped before migration. The new migration and restricted
role/schema verification passed; only Remote backend and web containers were
recreated. Both Remote and Beacon View public `/health` and `/ready` endpoints
returned 200 after rollout. Chrome loaded the new production landing page.
The Remote backend is healthy, the backup timer active, the `current` symlink
points to the exact new release, and the previous images remain tagged for
rollback. The protected production environment still lacks `SESSION_SECRET`,
so production viewing remains disabled. Initial readiness probes during
backend restart briefly returned 502 and recovered before rollout completion.

## Remaining gates

This rollout does not close milestone 4. Real Windows/Android desktop denial,
expiry, refresh, revoke, backend/agent restart, network-loss, display-lock and
sustained performance acceptance still require matching native artifacts and
human consent. Input, signed installation, public account lifecycle, and
one-time guest support remain unavailable.
