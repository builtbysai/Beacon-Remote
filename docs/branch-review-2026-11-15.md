# Source and publication review — November 15, 2026

The owner explicitly authorized finishing non-device work, publishing all source
to GitHub and deploying the matching release to the existing VM. Physical-device
acceptance remains excluded and sign-in media remains default-off.

The original D: checkout/private root were unavailable initially and became
accessible after the owner reconnected the drive. The existing branch and all
unpublished work were preserved; no older download package was substituted.
`git fetch origin` found main still 12 commits behind the current feature HEAD.

The live CLI inventory finds nine open PRs: #105 MCP, #106 RTC, #107 UUID,
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
