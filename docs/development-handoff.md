# Development handoff — 2026-10-10

## Scope and repository

Beacon Remote is in its own repository on `codex/approved-product-ui`.
[Draft PR #9](https://github.com/builtbysai/Beacon-Remote/pull/9) depends on #8.
The owner's continuation request authorizes milestones 5–8 in order after their
prerequisites. Work remains on milestone 4; do not present input or release
features as ready. Keep Beacon View source independent.

## Verified progress

- Session-scoped TURN grants reach both peers with strict native validation.
- Coturn's wildcard mapping caused the observed permission `403`: an isolated
  comparison returned `403` with wildcard and `200` with concrete relay address.
  A dynamic address wrapper fixed actual dual-relay synthetic decoding and Stop.
- The separate shared-service override now pins official Coturn 4.13.0 by digest.
  Isolated checks rejected IPv4 and mapped IPv6 loopback permission requests.
  Original View Compose/config/credentials are preserved; both products' public
  health/readiness passed after replacement. See deployment rollback instructions.
- Backend startup atomically ends interrupted grants and records audit before
  listening. Real PostgreSQL checks cover audit rollback, old-grant rejection,
  fresh pending requests and loss of either signaling peer.
- Startup now acquires exclusive database ownership before recovery. Actual backend
  subprocesses verified that a duplicate on another port preserves the live grant,
  owner connection termination stops its process, and replacement startup recovers
  the interrupted row with audit. See the restart recovery decision for connection
  lifetime and proxy requirements.
- Matching `e111946` native artifacts passed
  [Windows CI 38078446154](https://github.com/builtbysai/Beacon-Remote/actions/runs/38078446154),
  including Clippy, process-boundary tests and release build. Helpers join an
  unnamed, non-inheritable kill-on-close job before receiving a grant.
- Those binaries decoded synthetic video over relay/relay through patched Coturn.
  Forcibly terminating the fixture agent killed its helper, ended the browser
  session and persisted ended. Old browser WebSocket authorization returned 403.
  No desktop, microphone, input or recording was used in these tests.

Full local `pnpm check` passed with real PostgreSQL at port 5433 and
`TEST_DATABASE_URL`; database checks were not skipped. Local native formatting
passed. Local `cargo check` remains unavailable because MSVC `link.exe` is absent;
Windows CI supplies compilation. Temporary accounts, native identity directories,
exported relay secrets, test containers and the acceptance dev server were removed.

## Next actionable scope and external gates

The owner has no second device/network yet. Actual Windows desktop viewing from
a separate network is therefore **unverified**, despite successful synthetic
dual-relay transport. Production Remote remains at `ff452ff`, with media disabled;
the backend/native follow-ups are not deployed Remote application evidence.

Continue milestone 4 desktop acceptance: explicit local approval, Stop/denial,
expiry/logout/revoke, browser refresh, backend/agent restart, network loss,
display/lock/device loss, focus/readability and measured sustained performance.
Use fresh authorization after interruption. Keep one backend per database; stop
the predecessor before replacement. Do not revive persisted consent or enable
production media until the desktop/network gates pass.

Before further frontend work, satisfy the latest request's complete approved ZIP
inspection requirement; its prototype states are references, not real capability
or permission evidence. Keep the roadmap's ordered input, installation, account
and final UX/support milestones. Code-signing credentials and email delivery are
later external dependencies; no paid resources or Oracle tier changes are approved.
