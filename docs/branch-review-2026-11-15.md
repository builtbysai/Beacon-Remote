# Source and publication review — November 15, 2026

The owner explicitly authorized finishing non-device work, publishing all source
to GitHub and deploying the matching release to the existing VM. Physical-device
acceptance remains excluded and sign-in media remains default-off.

The original D: checkout/private root were unavailable initially and became
accessible after the owner reconnected the drive. The existing branch and all
unpublished work were preserved; no older download package was substituted.
`git fetch origin` found main still 12 commits behind the current feature HEAD.

The initial CLI inventory found nine open PRs: #105 MCP, #106 RTC, #107 UUID,
#108 serde_json, #110 PostgreSQL dependencies, #111 WebSocket, #112 globals,
#113 historical unattended roadmap, #114 CI action updates. The connector's
initial query returned no PRs; it is not used as the authoritative PR inventory.

Adopted on the feature branch: pg/@types/pg 8.23.1, WebSocket 11.3.4, globals
17.13.0, matching RTC/webrtc 0.21.1, UUID 1.28.0 and serde_json 1.0.154. CI pins
for pnpm/action-setup 6.1.1 and setup-java 6.2.0 were checked against upstream
tags, including the peeled annotated pnpm tag. Old PR lockfiles were not copied.
ESLint moved to 10.15.0 to remove vulnerable minimatch from its own paths.

The remaining minimatch advisory GHSA-g3hv-75wg-m249 is in TypeScript ESLint's
development tooling dependency, whose current upstream still requires 10.x.
No high/critical npm findings remain. A blind incompatible major override was
not applied. Backend packaging now removes development dependencies after build;
the lint-only dependency is not needed in the runtime image. Runtime image build
and installed-package verification remain deployment checks.

Full control-plane formatting/lint/typecheck/tests/build and high-severity audit
passed (`completion-control-plane-2026-11-15.log`). Both native configurations
passed full CI including release builds (`completion-native-enabled-2026-11-15.log`
and `completion-native-default-2026-11-15.log`). RustSec audit with warnings denied
passed (`rust-audit-2026-11-15.log`). Staged source secret scan passed with redacted
private reports. A broad directory scan was intentionally stopped and replaced
with staged-source scanning so build caches were excluded.

Independent encrypted source/private-state backup snapshot
`5484d60e9bc486d80a36e132547fce6f382e226dd0e0992029138fc9e051347a`
was saved in the existing C: repository. A separate restricted restore of the
completion checklist passed Restic verification and SHA-256 comparison. No
account wipe, signing-key rotation, runtime identity relocation or physical-device
action occurred. Production backup/restore and deployment receipts must still
be recorded when performed; this local restore is not a production DB restore.

New auth UX checks passed in real Chromium with synthetic API: intended-route
MFA, signed-in password recovery, inline errors/password visibility, slow login
across background polling, late navigation and responsive/rate-limit states.
No real email was sent or account credential published. Outstanding feature,
design, platform and acceptance requirements stay in the single checklist.

Final publication checkpoint: #115 merged as `849c636`; its head `79e2532`
passed all four GitHub CI jobs and was deployed to Remote. Migrations 025–029
and schema verification passed. Quiesced encrypted backup, repository integrity
and strict separate-database restore passed before migration. A fresh backup and
scheduled restore passed after migration. Remote and View health/readiness are
healthy; old app images remain available for rollback. Sign-in gates remain off,
and native update feeds remain unchanged. The scheduled operations wrapper now
selects exact current-release images and preserved private configuration.

Included dependency PRs #106/#107/#108/#110/#111/#112/#114 and the superseded
direction PR #113 were closed; #105 remains separate. Current follow-up source is
on `codex/workspace-polish`, preserving the published unattended branch.

## Subsequent review and Android follow-up

PR #117 merged as `713f58c`; verified head `96f64ec` was deployed with all four
CI jobs passing, recovery/schema/health checks and unchanged sign-in gates.
The original view-only MCP #105 was integrated and closed. New dependency PRs
#118-#123 appeared after the previous review; they are included in #124 rather
than treated as historical unpublished feature branches.

Reviewed updates: Fastify 5.12.8 (upstream security release), MCP SDK 1.32.2,
aligned Tungstenite/Tokio-Tungstenite 0.30 and WASAPI 0.27. The new WASAPI API
takes Copy enums by value and an optional audio-session GUID; the existing
loopback source uses None. Both native configurations passed full local checks.

Argon2 2.2.2 changes its underlying implementation. A fixed dummy PHC hash made
with the previously shipped 2.0.2 defaults verifies with the new version and
rejects the wrong password; new hashes also verify/reject correctly. Full local
backend account/MFA/recovery/policy tests, typecheck and build passed. No retained
account credential was used or changed. ARM64 runtime packaging remains part of
the VM verification before deployment.

Android UI/lifecycle source is commit `cafe33f`; candidate source `a6d114d` adds
the first reviewed dependency set. Android unit/lint/debug and actual guarded
emulator review passed, followed by existing-key release signing/verification.
Both Windows variants were rebuilt and signed from `a6d114d`; the existing
private-alpha self-signed certificate remains untrusted by public Windows roots.
No native feed, physical endpoint or system-service configuration changed.

The initial local control-plane attempt failed because Docker/test PostgreSQL
was stopped. A subsequent formatting-only failure followed documentation edits.
After restarting only Remote's own local database and formatting the documents,
full control-plane verification passed. The emulator's queued-completion fixture
was made deterministic by releasing the held dummy response only after the UI
queue is blocked; assertions are transferred back to the instrumentation thread
so failure still runs owned fixture cleanup. Final emulator review passed.

The read-only isolated unpaired Windows Settings window rendered and exposed
native labels/buttons to accessibility. Attempted resize did not confirm changed
bounds, so narrow/DPI/paired/error review remains open. The window was closed;
no service action or installed identity was used. Final GitHub and VM receipts
are recorded in the completion tracker after publication.

Final #124 receipt: merge `008a5bb`, tested/deployed application head `5e8d5c5`.
All four GitHub jobs passed in run `43781869285`. ARM64 actual compiled imports,
old/new password hashes and production-only dependencies passed. Quiesced VM
backup/integrity/strict isolated restore/schema and both products' health passed.
The source-only protocol import error was in the custom probe, not the actual
compiled app; the corrected runtime probe passed without a source change.
Existing-key candidates from `a6d114d` were checksum/provenance/signature-verified
and staged root-only on the VM. #118-#123 are closed as included. Fresh open-PR
inventory was empty; branches remain preserved. Sign-in gates and native feeds
remain unchanged. The completion tracker records the remaining physical and
implementation gaps; these publication receipts do not claim full completion.
