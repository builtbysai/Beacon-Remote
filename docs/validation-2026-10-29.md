# Unattended access development validation — October 29, 2026

Branch: `codex/unattended-access`, based on main `eb1ea99a`. Changes are local;
no commit, push, PR merge or deployment was performed. Production was inspected
read-only: web/downloads `eb1ea99a`, backend `2721aae`, healthy API/database,
media/control/relay enabled, and successful latest backup and restore drill.

## Implemented

Windows one-action unattended setup, automatic availability after pairing,
trusted owner control/files and sign-in startup, separate boot-service identity,
signed/replay-protected binding and presence, explicit unavailable desktop states,
local policy-change shutdown and service-aware uninstall. The boot service has no
IPC, desktop token, command-execution or process-launch API. Administrative
installation is still a real Windows permission boundary.

Android 11+ local standing permission plus policy-approved owner sessions,
accessibility screenshots feeding the actual WebRTC video source at a bounded
resolution/rate, persistent sharing controls, and shutdown on availability stop,
permission removal or screen lock. Guest support retains attended consent. Pixel
conversion runs off the UI thread, with synchronized observer shutdown before
the native video source can be disposed.

Both retain the short lease, single-controller policy and local revocation. A
30-minute idle limit excludes transport keep-alives. Receiving file chunks counts
as activity; Windows outbound chunks also count. Android outbound files, sound,
remote Windows login/UAC, and full MCP automation are separate work.

## Evidence

- `pnpm check` passed with the actual Remote PostgreSQL `_test` database and no
  database-test skips. Subsequent web label/documentation changes were checked
  with formatting, ESLint, strict types, web tests and production builds.
- `scripts/Test-RemoteCi.ps1 -NativeOnly` passed native formatting, Clippy with
  warnings denied, Rust tests and optimized workspace builds. New NTFS tests
  exercise protected directory creation/reuse and rejection of different ACLs.
- The real-process trusted-access fixture passed owner policy approval without
  clicking Allow, transport reconnect, local removal while only the policy HTTP
  route deliberately returned 503, and ended-session persistence. Guest codes
  still waited for Allow; remembered-helper policy remained independent. This run
  used a two-second hold, not the fixture's optional long-session soak. It exchanged
  media offers, not decoded video or injected input.
- Android unit checks, lint, debug app and instrumentation APK builds passed.
  On a new, unpaired Android 16 emulator, the instrumentation runner exercised
  Android's real accessibility service/screenshot API and native WebRTC source:
  bounded frames, pause/resume, availability stop, local permission revocation,
  and lock-screen shutdown passed. It sent no media over a network and stored no
  pixels. It also exercises shortened accessibility component names.
- Fresh `pnpm audit --audit-level high` and `cargo audit --deny warnings` passed.
  Updates include Zod 4.6.6, Vite 8.1.6, Fastify 5.12.6, zip 9.1.3,
  rustls-webpki 0.103.16, webpki-roots 1.0.11 and Tokio 1.54.1. No advisory was
  suppressed. The audit executable came from the official RustSec release and
  its published SHA-256 was verified before execution.

## Failures found and resolved

Root formatting tried to parse generated Gradle reports; generated Android build
directories are now excluded, with source still checked. The ZIP update changed
the entry-name API; extraction was adapted and existing package-integrity tests
passed. The fresh Rust audit found additional TLS/root-certificate and Tokio
advisories, which were patched rather than ignored.

Device-level testing found that the app compared raw accessibility component
strings, incorrectly rejecting Android's abbreviated form; it now parses actual
component names. Instrumentation also needed to rebind the service after replacing
the target process and initialize WebRTC before supplying native frames. Those
are explicit fixture setup steps, not mocked permissions or a production bypass.
The fresh emulator needed a real swipe lock enabled to exercise screen locking.
Review also fixed a late-heartbeat race after availability Stop and ensured
capturer callbacks cannot arrive after native source disposal.
The NTFS public-directory check exposed Windows mapping generic read/execute
rights during creation. The descriptor now uses the same explicit read/execute
mask, so exact verification accepts its own directories without relaxing the ACL.

## Release gates still open

The current Windows process is not elevated. Actual SCM install/start/stop,
administrator ACL/identity isolation, pre-sign-in presence, reboot, updater/repair
and service-aware uninstall have not been accepted on a second computer. No
service was installed on the owner's workstation and no UAC prompt was bypassed.

The isolated emulator was stopped after acceptance. Automatic approval review
blocked recursive deletion of `.remote-dev/unattended-avd` with "blocked by
policy" and no further reason; its files and this run's disposable native profile
remain local. No alternative deletion method was used. Existing profiles,
signing material, user devices and production rollback files were preserved.

A physical Android phone, battery/sleep behavior, protected-content handling on
that hardware, device reboot and real cross-network owner control/file-transfer
acceptance remain required. The emulator is not a substitute. Native and Android
setup UI have not received a complete visual/accessibility acceptance pass.

See [the acceptance guide](unattended-access.md). Migration 023 is additive and
must precede a matching backend/web rollout. Keep existing deployment, signing
material and rollback evidence intact. Broad cleanup follows device acceptance.
