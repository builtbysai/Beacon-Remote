# Beacon Remote: next-chat development and acceptance handoff

November 17, 2026. Read the workspace instructions, then this file, the
[parity roadmap](rdp-vnc-parity-roadmap.md), [test ledger](testing-remaining.md)
and [development status](development-status.md). The preceding chat ended with
this handoff and an RDP/VNC feature audit; development has since resumed below.
No new chat was created automatically. This document records scope and evidence;
it is not an independent grant of privileged/destructive authority.

## Resumed development checkpoint — November 17, 2026

The owner resumed development from this handoff and requested GitHub sync and a
durable continuation record. Continue on the same branch and draft PR #126.

- `754f585` updates TypeScript-ESLint 8.65.0 -> 8.73.0 through its supported
  dependency ranges, removing vulnerable minimatch 10.2.6. Frozen install, lint
  and workspace typechecking passed. Production dependency audit is clean.
- `be832b2` fixes viewer input release: blur/hidden/Escape/Stop invalidate pending
  clipboard reads, release clears remembered modifiers, and a newer paste wins
  over an older delayed read. Regressions reproduced stale typing and missing
  Shift before the fix, then passed; queued-paste cancellation/fresh-paste recovery,
  the full web suite, web build and formatting also passed. This is source-level
  evidence, not physical Windows acceptance or clipboard synchronization.
- `2fd40a3` completes that release fix: replacing a paced paste releases Enter/Tab
  before opening another clipboard request, including when permission is denied.
  Its regression, full web suite/build, lint, typecheck and formatting passed.
- CI [44196184046](https://github.com/builtbysai/Beacon-Remote/actions/runs/44196184046)
  at `be832b2` passed native/Android/security and full functional `pnpm check`;
  only the unchanged high dependency audit failed. The follow-up `2fd40a3` has
  local checks above; inspect latest PR-head CI separately after this handoff push.
- Full dependency audit still fails on high picomatch GHSA-fc5q-39xc-vjpf. Official
  registry latest is still 4.0.7; the [GitHub advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
  says no patched version.
  The audit service suggests >=4.0.8, but it is unpublished. No audit exception,
  dependency override or gate reduction was introduced. The moderate advisory is
  resolved on this branch; do not confuse default-branch alerts with branch audit.
- No phone/Surfiena/runtime state was changed or freshly inspected during this
  continuation. Device inventory and runtime rows below remain the prior physical
  checkpoint. Production/native feeds/sign-in gates and denied actions are unchanged.

Next bounded unit remains P0-2 normal Surfiena control and physical Stop/key/mouse
release, now including focus loss while holding Shift and delayed clipboard
permission followed by Escape/Stop. Use freshly built local viewer assets for
this source; `PIXEL_LOCAL_VIEWER=c22dc2f` is historical rotation evidence, not the
current viewer build. P0-1 remains blocked by the high advisory and acceptance
runtime alignment. Keep #126 draft and do not merge a failing gate.

## First actions: resume rather than rediscover

1. Use `D:/Dev/Beacon-Remote`, feature branch `codex/device-acceptance-preparation`.
   Read `D:/Dev/README.md`, product `AGENTS.md`, `docs/workspace.md`, security and
   architecture; dot-source `scripts/Enter-Workspace.ps1`. Check status and current
   remote HEAD. Do not create another checkout unless needed.
2. Inspect the actual Pixel and isolated runtime state. The backend's one-hour
   run has expired; availability alone does not prove server/media readiness.
   A bounded acceptance restart is different from the frozen legacy STOP fixture.
3. Restore only Beacon accessibility through normal Android settings if it is
   still off. Keep other services/settings unchanged. Standing access was cleared
   by the successful revocation test; enable it deliberately only for its test.
4. Choose and finish one complete roadmap unit. Recommended next unit: normal
   Windows input and Stop/key release on Surfiena, then installed Windows
   unattended/sign-in lifecycle. Pixel rotation no longer needs root-cause hunting;
   its viewer fix and physical local-build verification are complete.
5. Resolve publication gates independently of device tests. Do not merge a red
   release gate or enable sign-in authority/public native feeds from build results.

## Source, PR and runtime map

| Item                        | Verified checkpoint                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application branch          | `codex/device-acceptance-preparation`; application source `2fd40a31c0375428c64c56898380182a02997eae`; dependency update `754f585`; subsequent handoff changes are documentation                                      |
| PR                          | Draft [#126](https://github.com/builtbysai/Beacon-Remote/pull/126), only open PR at audit; do not delete retained branches                                                                                           |
| Recent fixes                | `c22dc2f`: allow later display geometry messages instead of treating them as clipboard replies; real rotation/input passed. `1afcc9e`: stale enabled status becomes off on accessibility revoke; physically verified |
| Production VM               | Application `5e8d5c511fa3ba542a3f2d79d78a0534ce5837b9`; Windows sign-in gates off; public native feeds unchanged                                                                                                     |
| Isolated backend            | `beacon-remote-acceptance-backend`, image `beacon-remote-backend:8af1c43bc35c4eebe93046ca51c61792c9bb61d5`; stopped after its one-hour bound                                                                         |
| Isolated web                | `beacon-remote-acceptance-web`, image `beacon-remote-web:0bba3539a3cdcf37daf3e44c412a2244bb947441`; old rotation bug still present in that served image                                                              |
| New VM image                | `beacon-remote-web:c22dc2f8012dab8b44ebac154cb1516b909d0477`, built, not activated; image ID `sha256:4b05d1ae7cefc379af8a7bb35060a2512afb85b0bc26781ac5c065c79e49b3f2`                                               |
| Pixel installed APK         | `dist/BeaconRemoteHost-1afcc9e3.apk`; SHA256 `7985f06318ed409c1b0a1cd0872d2bd3b9aa0f6e6087f08fe900f5c459fd9912`; existing signer, pairing preserved                                                                  |
| Earlier VM Android artifact | `d3290665056ada1417bbc8d4563ed55a4d377cce`, root-only candidate; newer `1afcc9e` APK still needs private VM staging                                                                                                  |
| Surfiena candidate          | Signed ordinary `d3bd11c`, bounded limited-user fixture; source and artifacts staged privately. Startup/toggle/blank-console checks passed; physical control still open                                              |
| Exact CI                    | `44196184046` at `be832b2`: Android/native/security and full functional `pnpm check` passed; only high dependency audit failed. `2fd40a3` follow-up passed local web checks; inspect latest PR-head CI separately    |

The high picomatch advisory GHSA-fc5q-39xc-vjpf had no patched registry release
when checked (registry latest 4.0.7, requested 4.0.8 absent). A recursive update
changed no lockfile. Recheck upstream before choosing a reviewed remediation;
do not invent a version or blindly override unrelated dependency majors. The
previously recorded moderate TypeScript-ESLint/minimatch advisory is resolved
by `754f585`; historical CI before that revision still includes it.

Read-only production inspection during this audit confirmed ordinary control is
configured true, ordinary media has its session configuration, and both sign-in
flags are off. This establishes configuration only, not usable installed-device
acceptance. No environment or service was changed by that inspection.

Automatic approval review rejected the prepared isolated-web replacement with
only **“blocked by policy.”** The command did not run. Do not retry that denied
deployment through another tool/route. The verified alternative was a local
compiled-static browser test, leaving VM services unchanged. An older dummy
browser-profile deletion and old ADB pairing-entry action also have retained
denial receipts; do not retry those specific denied actions. Manual new pairing
has already resolved the old pairing-entry issue.

## Devices and safe full-control setup

- Pixel 7a, USB serial `34171JEHN07672`, Android 17/API 37, package
  `com.beaconremote.host`. Always pass the exact serial; never run emulator-only
  setup/instrumentation on the owner's phone. ADB executable:
  `C:/Users/Saiha/AppData/Local/Android/Sdk/platform-tools/adb.exe`.
- Last documentation inventory: Pixel unlocked; AvailabilityService present;
  CaptureService and ControlService absent. The owner may use the device between
  tool calls: take a fresh screenshot before using UI coordinates. A permission
  restoration was not confirmed. Do not replay old taps on the home screen.
- Owner supplied a development unlock PIN in the current chat. It is sealed using
  Windows current-user DPAPI at
  `D:/Beacon-Secrets/remote/local/state/pixel-development-pin.dpapi`.
  Decrypt only in memory under the same Windows user and enter through normal
  authorized phone UI; do not print it, commit it, put it in command arguments,
  disable the lock or bypass a security barrier. Ask only if the credential no
  longer works or the supported OS flow genuinely needs a person.
- Surfiena: `ssh beacon-surfiena`, Tailscale `100.97.59.85`, Windows 11 Home,
  SSH user `saiha`, previously interactive session 1. Check current session and
  fixture state; old limited interactive tasks may have expired. SSH does not
  itself prove capture or an interactive desktop. Use maintained
  `scripts/acceptance/Windows-HostFixture.ps1`.
- Oracle: pinned `ssh beacon-oracle`, OpenSSH executable
  `C:/Program Files/OpenSSH/ssh.exe`. Use existing protected configuration;
  preserve View, shared Caddy/Coturn and unrelated listeners/processes.
- Full automation authorization covers ordinary test control and already approved
  setup; it does not mean silent UAC/UIPI/secure-desktop bypass, Android permission
  hacks, production account reset or arbitrary cleanup. Finish concrete work before
  requesting a genuinely required human/admin step. Never keep asking broad permission.

## Private evidence and repeatable fixtures

After Enter-Workspace, read the pointer
`D:/Beacon-Secrets/remote/local/state/active-acceptance-preparation.txt`.
The referenced directory contains the real retained isolated account/login,
browser session, Pixel/Surfiena machine receipts, APK/update/signing receipts and
physical test results. Never print their secret fields or substitute credentials.
The cookie expires; the private driver renews it using the existing login.

Useful private files under that pointed directory:

- `pixel-session-2026-11-17.mjs`: bounded eight-minute external Node driver.
  `state`, `tap x y`, `type beacon`, `compete`, `file`, `stop` commands over its
  live terminal. Taps map portrait/landscape physical dimensions. It uses browser
  events through Beacon for tested input; ADB arranges/observes targets.
- `pixel-session-*.json`: completed connected sequences, measured states,
  actions, backend end and owned browser-profile cleanup. Inspect exact receipts,
  not only the latest progress file, which is overwritten.
- `pixel-file-result-20261117.json`, `pixel-file-fixture.json`: actual 3 MiB transfer
  and matching device hash. The harmless named file remains on the Pixel.
- `pixel-vm-staging-2026-11-17.json`, `pixel-view-result.json`: earlier staging and
  view evidence. Newer receipts supersede their older candidate/runtime statements.

Driver invocation from the product shell (private script path comes from the pointer):

```powershell
. ./scripts/Enter-Workspace.ps1
$env:BEACON_REPO = (Get-Location).Path
$prep = (Get-Content (Join-Path $env:REMOTE_DEV_STATE_DIR 'active-acceptance-preparation.txt') -Raw).Trim()
# Only when testing the matching locally built web assets:
$env:PIXEL_LOCAL_VIEWER = 'c22dc2f'
# For a deliberate refusal test only; otherwise leave this unset:
# $env:PIXEL_EXPECT_TERMINAL = 'denied'
node (Join-Path $prep 'pixel-session-2026-11-17.mjs')
```

Build the matching web source before selecting local assets. That fixture serves
only compiled HTML/JS/CSS into its own browser; real API/WebSocket responses and
authorization stay on `https://remote-test.builtbysai.com`. Its receipt records
static asset hashes. This is local-candidate evidence, not hosted deployment.
Do not run stale `pixel-control*.mjs` scripts: they used UIAutomator, which can
suppress accessibility and invalidate a physical control test. Use ADB screenshots
for observation; no saved video/recording without its own test permission.

The Node REPL is useful for screenshots, but run this driver in an external Node
process: the REPL lacks global `process`/`WebSocket`. Use the maintained viewer's
guarded owned-profile cleanup; no arbitrary Chrome/profile/process sweep.

## VM and backup continuation

The isolated preparation root is
`/etc/beacon-remote/acceptance-preparation/5637c13efac74c709b78b7ce20b4bd14`.
Its independent database is `beacon_remote_acceptance_20261010`, role
`remote_acceptance_20261010`. Existing session/TURN secrets must stay in place.
Ordinary control is enabled there; sign-in authority/media are off. Preserve the
one-hour backend lifetime and restart:no policy. Check no active sessions before
any permitted bounded restart. Never use production DBs for tests.

Compose layers, in order, are the acceptance base, consent override, viewer image
override, runtime acceptance override, preparation `current-images.override.json`,
`readable-pairing-8af1c43bc35c4eebe93046ca51c61792c9bb61d5.override.json` and
`bundled-viewer-0bba353.override.json`. Resolve actual files on the server and
preserve all environment/command layers; do not render secret values into output.
Do not execute the previously denied rotation-viewer update from this file.

Source snapshots/extractions through `c22dc2f` and its built image exist privately
under `/opt/beacon-remote/source-snapshots`, `/opt/beacon-remote/releases` and Docker.
The source-only `1afcc9e`/final handoff and its APK still need staging. The owned
upload directory `/tmp/beacon-remote-pixel-candidate.G20P1sQQ` was retained; no
recursive deletion was attempted. Artifact checks passed; two earlier shell scripts
reported a trailing CR error after their successful checks, so follow-up direct
queries confirmed staging. Strip CR on PowerShell-to-bash input or use binary-safe
stdin handling; do not rerun CreateNew staging scripts blindly.

Independent encrypted recovery is under `C:/Users/Saiha/Beacon-Backups` and the
existing external private root; prior backup/integrity/disposable restore and
schema preparation passed. Preserve these and follow recovery before data
moves/deletions. Do not relocate installed identities/server secrets, delete
volumes, kill unknown listeners or touch `D:/0 - Do Not Touch`, View or Motive.
Retained test credentials are still needed; rotate/delete only after full completion.

## How to avoid another incomplete testing loop

Pick a roadmap ID and a bounded test unit with a terminal condition. Record the
build/device/network, action, observed result, refusal/revoke, backend end, capture/
input release and cleanup immediately after that unit. Update the current ledger
and commit before starting the next unit. If a genuine blocker appears, preserve
the receipt and do independent work; do not re-run passing setup checks as progress.
Do not claim a feature accepted from compilation or silently treat a failed test
as pending without its failure evidence. The detailed parity backlog includes
features that have not been implemented at all; tests cannot supply those features.

Suggested owner message for the new chat:

> Continue Beacon Remote from D:/Dev/Beacon-Remote. Read docs/next-agent-handoff.md,
> docs/rdp-vnc-parity-roadmap.md and docs/testing-remaining.md. I authorize development
> and automated testing with full control of my connected Pixel through ADB and
> Surfiena through its existing SSH setup, within the documented OS/consent and
> product boundaries. Use the existing private credentials; the Pixel development
> unlock credential is sealed outside Git. Finish complete roadmap/test units,
> commit/push checkpoints and report genuine human-only or automatic-review blocks.
> Do not repeat completed tests, wipe accounts or bypass prior denied actions.
