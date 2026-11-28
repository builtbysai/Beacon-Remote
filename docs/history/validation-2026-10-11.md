# Local validation and manual rollout — 2026-10-11

PR #11 merged as `4ea7ad97eac00ca6b8b33f7c168aa34e5a2f4d28` at the owner's
explicit request after local checks. GitHub jobs did not start because of its
account payment/spending limit. This is a recorded alternative validation path,
not a claim that those jobs ran or that release gates were removed.

Local Node 22.22.0/pnpm 11.9.0 formatting, lint, types, real PostgreSQL
regressions, backend/web builds, production dependency audit and native formatting
passed. `scripts/Test-RemoteCi.ps1 -ControlPlaneOnly` repeated the control-plane
CI commands using Remote's independent test database. The full script discovers
MSVC/Windows SDK and runs Clippy/tests/release build; it restores process
environment afterward to preserve shared-workstation configuration.

Native source/Cargo manifests/lockfile are unchanged from validated Windows CI
head 0979cd1 (run 38083605846). Matching binaries were reused. Local native
compilation is still unavailable: the authorized official Microsoft Build Tools
installer reached UAC and then exited 1602 before completing. There is no claim
that local Clippy, native tests or release compilation passed. Complete legitimate
Windows elevation/installation to enable those steps; never bypass OS controls.

## Production control plane

Exact merged release 4ea7ad9 was uploaded by authorized SSH and extracted into a
new `/opt/beacon-remote/releases/<full-sha>` directory. Prior ff452ff backend/web
image IDs were retained as `rollback-ff452ff`. Encrypted Remote backup and Restic
integrity check passed before rollout. Writes were quiesced; a separate-database
restore drill passed and removed only its owned verification database. Explicit
migration and schema/application-role verification passed before backend/web
replacement. Previous backend was stopped before new ownership acquisition.

Public health/readiness passed for Remote and View. Production SESSION_SECRET
absence was checked without displaying secrets; **media remains disabled**.
Current symlink points to 4ea7ad9. One transient 502 occurred while the app was
recreated and recovered in the readiness retry. No shared Caddy/Coturn or View
application deployment was changed. Private-alpha account gates still apply.

Rollback uses the retained ff452ff images and release Compose: stop only Remote
backend/web, retag those exact images to their Compose latest names, start prior
backend/web without rebuilding, and repoint current. Schema remains additive and
compatible; do not delete volumes or restore over the live database automatically.
See deployment.md and the verified operations supplement for commands.

## Isolated media acceptance

The stopped acceptance backend was replaced with previously built/validated
`beacon-remote-acceptance-backend:0979cd1`; web initially remained b1c2ae4.
HTTPS health/readiness passed. The matching agent reused its isolated DPAPI
identity through the tracked runner; normal owner pairing remained intact.

A real Chrome/native **synthetic** request decoded 1280×720 frames through
Oracle's patched relay. Browser diagnostics showed relay/relay, policy relay,
connected ICE and 1,103 frames at observation. Restarting only the acceptance
backend stopped the helper/stream; Chrome displayed Session ended with 1,452
frames, and the agent subsequently restored presence. A fresh synthetic grant
connected after restart. No desktop, microphone, input or recording was used.
This extends synthetic recovery evidence; real desktop interruption and sustained
mobile-data performance/consent-window latency remain human acceptance gates.

Viewer diagnostics now include actual first-frame/approval timing, presented FPS
and selected-pair RTT. Timing starts at viewer setup, not button click; approval
includes human response and cannot establish when a native dialog appeared.
No secrets/candidate addresses/pixels are recorded by these measurements.

Matching web commit 4324907 was built and installed only in acceptance after
the local control-plane validation passed. Actual Chrome/native synthetic
diagnostics showed host ready at 1,346 ms, first presented frame at 5,436 ms,
4,090 ms from host readiness to first frame, 30.5 presented FPS and 72 ms RTT,
with relay/relay selected. These are one observation, not a sustained benchmark
or a measurement of desktop consent-window appearance. Browser Stop ended the
stream. The user was invited to retest actual desktop on Android/mobile data;
no result from that next human test is claimed here.
