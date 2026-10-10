# Approved interface validation — 2026-10-10

The supplied clickable public/auth/workspace prototype was reviewed before
integrating its brand assets and blue/slate design into React/Vite. Prototype
HTML, simulated devices and permission grants were not embedded in the app.

Implemented: public navigation, invitation/login forms, authenticated workspace,
inventory search/status filtering, inspector/inline naming, pairing, view-request
history, audit activity and browser-session settings. The native Stop window
adds controller identity, view-only capabilities, peer connection state and
system-DPI-scaled geometry. Existing consent, lease and Stop enforcement remain.

Full formatting, lint, TypeScript checks, real PostgreSQL regressions and builds
passed locally. Windows format/Clippy/tests/release and backend/web CI passed at
`ff452ffe66dd600e9a7b18d12fccc08ac970a7d6` in
[run 38062467253](https://github.com/builtbysai/Beacon-Remote/actions/runs/38062467253).
An initial native compile error was fixed by importing SS_NOPREFIX from the
official SystemServices module before rollout.

Actual Chrome checks covered protected sign-in/logout, UI-issued pairing consumed
by a real Windows agent, inventory appearance, persisted inline naming, ending
other browser sessions while preserving this browser, synthetic decoding and
browser Stop. Escape closed the inspector and restored row focus. Viewport checks
covered 320, 390, 768, 1024, 1440 and 1920 pixels, plus 844×390 landscape. Light/dark
appearance was visually checked; tested states had no horizontal overflow or
clipped controls. The latest CI helper also started and decoded synthetic video;
the redesigned native window's human readability/Stop check is pending.

Oracle runs exact release `ff452ffe66dd600e9a7b18d12fccc08ac970a7d6` with production
media grants disabled. Encrypted pre-rollout backup/integrity and additive media
schema/application-role verification passed. Prior release
`2c8f944c5e44ff765baa1671a70ea9202b9b688c` and explicitly tagged backend/web rollback
images remain retained. PostgreSQL, shared edge and Beacon View were preserved.
Container recreation briefly returned 502; retry recovered, then Remote readiness
and View health returned 200. The live HTTPS app signed in using the existing
temporary account and showed its real offline computer, enrollment event and
current browser session. Approved assets load under the existing CSP. No test
fixtures entered the production database or frontend.

MFA, recovery, public registration/email verification, guest support, signed
installer/update distribution, pause/resume and input remain unavailable. Native
idle/tray UI and the complete host-state flows remain follow-up work. OS build,
CPU/RAM, groups and favorites are omitted where there is no real backend state.
Local desktop viewing has acceptance evidence; cross-network/forced relay does
not. Production media stays disabled and the input milestone was not started.
No new paid infrastructure or service was introduced.
