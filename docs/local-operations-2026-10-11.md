# Verified local operations supplement — 2026-10-11

This preserves the authorized-machine observations from October 10 and adds
local coexistence work on October 11. It supplements, rather than replaces,
CLAUDE_HANDOFF.md. Reverify running infrastructure before deployment: the new
session deliberately did not change shared Oracle Caddy/Coturn or production.
See local-development.md for the new isolated launcher and workspace inventory.

## Current source of truth

- Repository: https://github.com/builtbysai/Beacon-Remote
- PR #8 and dependent PR #9 are merged into main. Documentation was subsequently
  consolidated through `a1baf02`; complete implementation before handoff was
  `0979cd12f3371f5eabec2fbc703808eb5b53213b` on `codex/approved-product-ui`.
  Resolve the final documentation commit with `git rev-parse HEAD`; a document
  cannot contain its own final commit hash.
- Production: `ff452ffe66dd600e9a7b18d12fccc08ac970a7d6`, media **disabled**.
- Last actual mobile-data acceptance: backend/web/native `b1c2ae4`.
  Updated backend image `beacon-remote-acceptance-backend:0979cd1` was built on
  Oracle but **not installed or device-tested**. Last web image remains b1c2ae4.
- Active milestone: **4, attended desktop viewing**. Input remains absent.
- Immediate next task: use matching validated 0979cd1-or-later backend/native
  builds in the isolated acceptance environment; re-test consent arrival on the
  owner's Android/T-Mobile connection. Measure request-to-dialog and
  approval-to-first-frame latency. Then finish the real-desktop lifecycle matrix.

## First session

1. Read `CLAUDE.md`, `AGENTS.md`, this document, `docs/roadmap.md`,
   `docs/security.md`, `docs/architecture.md`, `docs/protocol.md`,
   `docs/decisions/0008-backend-restart-recovery.md` and
   `docs/decisions/0009-prompt-request-delivery.md`.
2. In PowerShell: `Set-Location C:\Dev\Beacon-Remote`; `git fetch --prune`;
   `git status --short`; `gh pr list --state open`; `gh run list --limit 5`.
   Start a new `codex/` branch from current main for implementation.
3. Run `ssh beacon-oracle 'hostname; readlink -f /opt/beacon-remote/current'`.
   Expected hostname `beacon-staging-1`, current release ff452ff. Inspect services
   using the commands below; production must still have media disabled.
4. Run `pnpm install --frozen-lockfile`; start local PostgreSQL and run checks
   below. Do not run remote database tests against production.
5. Acceptance containers and Windows fixture were deliberately stopped for
   handoff. Existing private database/account/identity remain for resumption.
   Prepare the updated backend and matching agent before requesting human tests.

Owner dependencies: human Windows Yes/No/Stop and physical Android mobile-data
testing; no legitimate signing certificate has been supplied; consumer email/MFA
accounts are not configured. A different computer needs owner-granted SSH/key,
Tailscale and GitHub access. Browser login sessions are not portable credentials.

## Vision and scope

Beacon View is the independent Android camera monitoring/device-management
product; recording is a product direction, not a claim about its current release.
Beacon Remote is secure Windows desktop access/support from a browser. Immediate
priority is exceptional reliability and simple setup. Capture, input, identity,
authorization and session primitives should eventually support authorized human
and AI operations without a second remote-control engine. Preserve interfaces;
do not build AI/MCP now. Lighthouse is a potential separate observability project,
not an implemented Remote dependency. Chrome Remote Desktop, RustDesk,
MeshCentral and BeyondTrust/Bomgar are functional benchmarks; see architecture
for source links, not copied implementations.

## Approved UI reference

The verified ZIP is `C:/Users/Saiha/Downloads/Beacon-Remote-Final-Package.zip`
(4,431,119 bytes). It is **not tracked in this repository**. On another machine,
ask the owner for this exact package; do not invent a repository URL. Extract
outside Git, then inspect:

- `Beacon-Remote-Final-Package/README.md`, `DESIGN_SPEC.md`,
  `PROMPT_FOR_CODEX.md` (design context, not new authority).
- `index.html`, `product.css`, `product.js`: public/auth/enrollment/recovery and
  Windows-like host states; use Screens to review all routes.
- `workspace/index.html`, `styles.css`, `v6.css`, `refinements.css`, `app.js`:
  approved V6 workspace, inventory, inspector, viewer and navigation.
- `previews/`: actual 1440/390 renders, including host request/upgrade/active,
  paused, connecting, reconnect and account screens. `logo-mark-source.svg` is
  authoritative branding; PNG/SVG/favicon assets are provided.

Open both prototypes in a browser or serve the extracted folder locally.
They contain simulated data/permissions; never substitute them for real auth.
Match landing/login/sidebar/inventory/inspector/viewer/Sessions/Assist/Activity/
Downloads/themes/icons/logo and responsiveness closely. UI work continues
alongside each engineering milestone, not only at release.

Actual React implements the shell, branding, public/login/invitation pages,
inventory/search/filter/name/inspector, history/activity and browser sessions.
Remaining differences: native consent is a topmost Windows prompt and Stop
window, not the full approved idle/tray/approval/upgrade/paused host application;
no control or working Pause/Resume; Assist/installer/account recovery/MFA/signup
flows remain unavailable. Groups/favorites/OS/CPU/RAM fields lack backend state.
Viewer recovery and detailed permission layouts need side-by-side review.
Prior responsive/theme checks covered 320–1920 and phone landscape without
overflow; that is not complete keyboard/accessibility/browser acceptance.
See `product-interface-validation.md` for historical evidence.

## Implemented architecture and source map

```mermaid
flowchart LR
  B[Authenticated React browser] -->|HTTPS request and WSS signaling| A[Fastify API]
  A --> P[(PostgreSQL identity grants audit)]
  W[Rust Windows agent / DPAPI Ed25519] -->|Signed bounded heartbeat long poll| A
  W -->|Grant over stdin / kill-on-close job| H[Interactive session helper]
  H -->|Authenticated WSS and lease renewal| A
  H -->|H.264 WebRTC encrypted transport| B
  H <-->|UDP TURN fallback| T[Coturn]
  T <-->|Relayed WebRTC| B
  C[Visible consent / WGC primary display] --> H
```

| Component             | Real source and state                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React/Vite            | `apps/web/src/main.tsx`, `Product.tsx`, `ComputerInspector.tsx`, `LiveView.tsx`, `AccountPanels.tsx`, `SessionHistory.tsx`, CSS; real state, honest unavailable features                   |
| Fastify               | `apps/backend/src/app.ts`, `config.ts`, `sessions.ts`, `relay.ts`; account isolation, exact Origin, rate limits, strict grants, authenticated WSS                                          |
| PostgreSQL            | `apps/backend/migrations/`, scripts migrate/verify; accounts/browser sessions/machines/enrollment/nonces/audit/view sessions                                                               |
| Agent                 | `apps/windows-agent/src/main.rs`, `sessions.rs`, `helper_lifetime.rs`; Ed25519, user DPAPI, enrollment/replay-resistant presence and job-bound helpers                                     |
| Interactive helper    | `apps/windows-session/src/capture.rs`, `encoder.rs`, `media.rs`, `indicator.rs`, `renewal.rs`, `pixels.rs`; WGC, bounded BGRA→NV12/Media Foundation H.264, webrtc-rs, visible consent/Stop |
| Capability boundaries | `crates/remote-core`, `packages/protocol/src/index.ts`; capture/snapshot/input/lease interfaces, input envelopes only; no injection endpoint                                               |
| Recovery              | `backend-ownership.ts`, `index.ts`, sessions; one backend DB advisory owner, atomic interruption audit and old-grant rejection                                                             |
| Hosting               | `infrastructure/oracle/`; Caddy, isolated Compose/PostgreSQL, backup, relay wrapper                                                                                                        |

Agent is a development process, **not a Windows service**. Service/session
separation, restricted authenticated IPC, tray, installer/signing/update/uninstall
are milestone 6 plans. Stdin helper handoff/job lifetime is implemented; do not
claim restricted service IPC exists. WGC starts only with local consent, connected
peer and live lease. Two-minute grant and monotonic renewal bound access. No
microphone, recording, control or automatic session resurrection. Revocation,
logout, disconnect and Stop invalidate access; re-request fresh approval.
WebRTC encryption is not a claim of independently authenticated E2EE against a
malicious signaling service. Only UDP TURN supported; TCP/TLS rejected.

## Verified access and operations

Existing Oracle Free Tier VM: Ashburn (`us-ashburn-1`), hostname
`beacon-staging-1`, public IPv4 `129.213.128.206`, private `10.0.0.254`,
Tailscale `100.67.27.65`. Actual OCI instance display name/OCID requires dashboard
confirmation; do not infer it from hostname. Allocation already uses 2 A1 OCPUs/
12 GB RAM. Do not resize or add paid resources.

`C:/Users/Saiha/.ssh/config` verified alias:

```text
Host beacon-oracle
    HostName beacon-secureview-oracle
    User ubuntu
    IdentityFile C:/Users/Saiha/Downloads/ssh-key-2026-09-06.key
    IdentitiesOnly yes
    HostKeyAlias 129.213.128.206
    StrictHostKeyChecking yes
```

MagicDNS resolves hostname to `beacon-secureview-oracle.tailffbae4.ts.net` /
100.67.27.65. Authorized Tailscale connection is required for this alias; no
bastion was used. Never disable host verification or print/copy key contents.
Key path is a reference, not permission to publish it. `ssh beacon-oracle hostname`
was successful during handoff. Public-IP SSH is not verified as an alternative.

| Environment        | Verified location/services                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote production  | `/opt/beacon-remote/current` → `/opt/beacon-remote/releases/<ff452ff-full-sha>`; `infrastructure/oracle/compose.yaml`, project `beacon-remote`, root 0600 `/etc/beacon-remote/production.env`                          |
| Remote containers  | `beacon-remote-backend-1`, `beacon-remote-web-1`, `beacon-remote-postgres-1` (Postgres 17.6); database `beacon_remote`, restricted `remote_app`                                                                        |
| Acceptance         | `/opt/beacon-remote/acceptance/20261010-b1c2ae4` and `20261010-0979cd1`; `/etc/beacon-remote/acceptance-compose-20261010.yaml`; `beacon-remote-acceptance-backend`, `beacon-remote-acceptance-web` stopped for handoff |
| Test private state | Root 0600 `/etc/beacon-remote/acceptance-20261010.env`, `acceptance-login-20261010.json`; database `beacon_remote_acceptance_20261010`, restricted role `remote_acceptance_20261010`; preserved                        |
| Shared edge        | `beacon-secureview-cloud-web-1`; `/etc/caddy/Caddyfile` inside container imports `/etc/caddy/products`, mounted from `/etc/beacon/products`; TLS data/config Docker volumes retained                                   |
| Test edge          | `/etc/beacon/products/beacon-remote-acceptance.caddy` and `/etc/beacon-remote/acceptance-web.Caddyfile` retained; test hostname returns unavailable while containers stopped                                           |
| Shared TURN        | `beacon-secureview-cloud-coturn-1`; View Compose `/opt/beacon/app/infrastructure/cloud/compose.yaml`, protected `/etc/beacon/production.env`, Remote override `/etc/beacon-remote/turn-relay.override.yaml`            |
| View               | Separate `beacon-secureview-cloud-backend-1`, `-postgres-1`, shared web; never run Remote migrations against them                                                                                                      |

Cloudflare DNS-only A records: `remote.builtbysai.com` (production) and
`remote-test.builtbysai.com` (temporary test) to public VM. View origin is
`https://beacon.builtbysai.com`. Caddy manages TLS; preserve its data volumes.

```sh
# Run through ssh beacon-oracle or in an authenticated SSH shell.
sudo docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
sudo docker logs --tail 80 beacon-remote-backend-1
sudo docker logs --tail 80 beacon-secureview-cloud-coturn-1
sudo systemctl status beacon-remote-backup.timer --no-pager
sudo journalctl -u beacon-remote-backup.service -n 30 --no-pager
curl -fsS https://remote.builtbysai.com/health
curl -fsS https://remote.builtbysai.com/ready
curl -fsS https://beacon.builtbysai.com/health
curl -fsS https://beacon.builtbysai.com/ready
```

Do not dump Docker environment, full command arguments or rendered Compose:
they contain credentials. Inspect only named safe fields. See deployment.md for
the exact Coturn-only override command. Apply it on future TURN maintenance.

## Development commands

Node >=22.13 <23; pnpm 11.9.0; Docker/Postgres 17.6; stable Rust; Windows C++
Build Tools MSVC and Windows SDK for native builds. No Rust toolchain pin exists;
CI updates stable. This PC lacks `link.exe`; compilation/Clippy/tests/release
builds use GitHub Windows CI. Backend/web work can run elsewhere, capture/DPAPI/
Media Foundation/real helper tests require interactive Windows.

```powershell
git clone https://github.com/builtbysai/Beacon-Remote.git
Set-Location Beacon-Remote
git switch -c codex/next-m4-acceptance
pnpm install --frozen-lockfile
docker compose -f infrastructure/compose.yaml up -d
$env:DATABASE_URL='postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_dev'
$env:WEB_ORIGIN='http://127.0.0.1:5174'
pnpm --filter @beacon-remote/backend db:migrate
pnpm --filter @beacon-remote/backend db:verify
# Supply REMOTE_ACCOUNT_EMAIL/PASSWORD privately, then account:create; clear them.
pnpm --filter @beacon-remote/backend account:create
# Separate terminals with same backend environment:
pnpm --filter @beacon-remote/backend dev
pnpm --filter @beacon-remote/web dev
docker compose -f infrastructure/compose.yaml exec -T postgres createdb -U remote_dev beacon_remote_test
$env:TEST_DATABASE_URL='postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test'
pnpm check
pnpm audit --prod --audit-level high
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --release --locked
```

`createdb` is one-time; existing target is not an error requiring deletion.
Tests require `_test` database; without TEST_DATABASE_URL DB checks skip. Startup
does not load `.env` automatically. Private media test: supply independently
generated SESSION_SECRET (64 lowercase hex), optional STUN_URL, paired TURN_URLS/
TURN_SECRET and policy `all` or `relay`. Never obtain secrets by printing them.
Open 127.0.0.1:5174; login/Add computer; run matching sibling executables:

```powershell
target/release/beacon-remote-agent.exe pair
target/release/beacon-remote-agent.exe run
target/release/beacon-remote-session.exe displays
# Asks human consent, 10 seconds, in-memory only:
target/release/beacon-remote-session.exe capture-benchmark
$env:NATIVE_AGENT_PATH=(Resolve-Path target/release/beacon-remote-agent.exe).Path
pnpm --filter @beacon-remote/backend test:native
gh run view 38083605846
gh run download 38083605846 -n windows-agent-development -D .agent-state/android-acceptance-0979cd1
```

Download only after full run succeeds; artifact retention seven days, thereafter
rebuild exact source. Executables must be adjacent and match backend grant fields.
Don't replace normal `%LOCALAPPDATA%/BeaconRemote/identity.dpapi` with a fixture.
Local backend logs are terminal stdout; agent logs exclude grants/signatures/media.

## Resuming temporary Android acceptance

Tracked runner: `scripts/android-acceptance-host.mjs`; the old external
`C:/Dev/beacon-remote-android-host.mjs` wrapper is archived, not an active entry point.
Isolated identity/
private login at `C:/Users/Saiha/.beacon-remote-recovery/android-acceptance-20261010`.
Its `native-status.log` is preserved; `STOP` marker intentionally present.
The runner now points to downloaded validated 0979cd1 artifacts and skips the
entire login/enrollment/pair block when its isolated `BeaconRemote/identity.dpapi`
exists. Syntax validation passed; it was deliberately not restarted. Never
re-pair an existing identity or issue an unused invitation. Remove
only that fixture's STOP marker when deliberately restarting it. Run with Node;
45-minute lifetime. Job-bound helpers stop with agent; no automatic consent.

Oracle operational Compose now selects the built 0979cd1 acceptance backend;
`config --quiet` passed. Both containers remain stopped. Start only its two services:

```sh
sudo docker compose -f /etc/beacon-remote/acceptance-compose-20261010.yaml config --quiet
sudo docker compose -f /etc/beacon-remote/acceptance-compose-20261010.yaml up -d
curl -fsS https://remote-test.builtbysai.com/ready
```

One-hour backend lifetime/restart=no is intentional; preserve isolation. Web b1c2ae4
is unchanged by the latency fix. Never rerun initial provisioning script against
existing state. Credentials are already in protected files, not in this document.
Ask owner to disable Wi-Fi/VPN/Tailscale on Android and use T-Mobile data, open
test origin/login, request synthetic first, then real desktop. Human closes
private windows and approves Windows dialog. Human Stop must end actual video.
Record browser version, visible moving frames, selected candidates, latency/FPS/
CPU/RAM without saving private desktop pixels.

## Deployment and rollback runbook

Production was deliberately not changed by consolidation. Exact current workflow
is a Git archive of a validated commit uploaded over authorized SSH, root-owned
release extraction, Compose build, explicit migrate/verify, backend/web replacement,
then current symlink. Do not deploy merely because main merged.

1. Inspect `readlink -f /opt/beacon-remote/current`, running image IDs and CI for
   exact target (`gh run list --commit <sha>`). Review migration compatibility,
   supported private-alpha scope and release gates. Production Compose omits
   SESSION_SECRET: confirm boolean false without displaying env values.
2. In SSH shell define `old=$(readlink -f /opt/beacon-remote/current)`. Define
   `dc_old()` invoking `sudo docker compose --project-name beacon-remote
--env-file /etc/beacon-remote/production.env -f "$old/infrastructure/oracle/compose.yaml" "$@"`.
   Run `dc_old run --rm --no-deps backup run`, then `backup check` using same
   run prefix. Never `backup init` an existing repository. Stop backend to quiesce
   writes for an isolated restore drill; export
   REMOTE_ALLOW_ISOLATED_RESTORE=RESTORE_A_SEPARATE_DATABASE to privileged Compose
   process, run `restore-check`, then restart old backend. The guard refuses any
   existing restore-check DB and removes only its own target. Retain old image IDs
   and tag backend/web `rollback-<old-short-sha>` before build. Do not delete them.
3. Locally `git archive --format=tar -o C:/Dev/beacon-remote-release.tar <sha>`;
   `scp C:/Dev/beacon-remote-release.tar beacon-oracle:/tmp/beacon-remote-release.tar`.
   Verify exact SHA, create **new** `/opt/beacon-remote/releases/<full-sha>`, extract
   archive there. Never overwrite an existing release. Define analogous `dc_new()`
   using that absolute release Compose and same project/protected env.
4. `dc_new config --quiet`; `dc_new build backend migrate verify web backup restore-check`.
   Stop predecessor backend before migration/replacement (one owner per DB).
   `dc_new run --rm --no-deps migrate`; `dc_new run --rm --no-deps verify`.
   On failure keep old backend recoverable; don't continue rollout.
5. `dc_new up -d --no-deps backend web`. Check actual health/ready, logs, login,
   isolated human pairing/presence/revoke and supported functionality. Check both
   View endpoints above. Only after success `sudo ln -sfn
/opt/beacon-remote/releases/<full-sha> /opt/beacon-remote/current`.
   Keep independent backup timer enabled; its current symlink selects operations.
6. Rollback: stop new backend/web only, retag retained old image IDs to Compose's
   `beacon-remote-backend`/`beacon-remote-web`, then `dc_old up -d --no-deps backend web`
   **without --build**; repoint current to old release. Verify both products.
   Additive schema may remain only when old app compatibility was verified.
   Destructive migration needs its own reviewed recovery plan; never restore
   over production automatically. No `compose down`, volume deletion or image
   prune. A failed rollout can briefly return 502; don't call health alone success.

Backup uses isolated encrypted Restic OCI prefix in existing private
`beacon-backups` bucket, 32 MiB dump budget; independent timer. Protected root
env stores backup credentials. Owner-scoped DPAPI recovery material exists in
`C:/Users/Saiha/.beacon-remote-recovery`; verify required files privately. Retention
and quota must be reviewed before growth. No new bucket/tier/billing permission.
Shared Caddy/Coturn are not part of ordinary Remote app recreation.

Acceptance stop: `sudo docker stop beacon-remote-acceptance-backend
beacon-remote-acceptance-web`; local fixture STOP marker. This is current state.
Preserved test DB/private files are explained operational state, not abandoned
implementation. Permanent teardown instructions in android-acceptance document;
remove only named test resources, validate/reload Caddy and verify both products.

## Evidence, remaining tests and lessons

| Area                 | Passed evidence                                                                                                                    | Still outstanding                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Identity/presence    | Real Windows pair/DPAPI restart/signed presence/revoke, production private-alpha acceptance                                        | Full consumer lifecycle                                                         |
| Capture/encode       | Actual local WGC primary desktop, bounded H.264 Chrome decoding; short CPU/RAM sample only                                         | Sustained performance, DPI/rotation/display-loss/lock/GPU variations            |
| Consent/Stop         | Human Yes/local Stop, No default/topmost prompt; actual Android mobile-data desktop/Stop confirmation                              | Updated long-poll prompt latency and broad focus/readability acceptance         |
| Direct               | Local desktop connection evidence                                                                                                  | Separate-network direct path explicitly verified with all policy                |
| TURN                 | Isolated permission correction; native dual-relay synthetic decoding; Android mobile-data desktop on forced-relay configuration    | Phone candidate metrics/browser version; broader relay/network reliability      |
| Expiry/revoke/logout | Actual synthetic deadline/Stop/logout plus real DB/WSS ownership/replay/revocation regressions                                     | Real desktop mobile-data expiry/denial/revoke/refresh interruption matrix       |
| Recovery             | Actual synthetic forced agent kill killed helper, ended DB, old grant 403; real backend ownership/replacement DB subprocess checks | Desktop backend restart, agent restart, network interruption and fresh approval |
| UI                   | React integration, actual responsive/theme/local account error recovery                                                            | Complete approved native/product flow fidelity and accessibility                |
| Production           | ff452ff HTTPS/login/pair/presence, backup/restore and rollback retained                                                            | Media release gate, input, signed installer, consumer auth                      |

The owner confirmed **synthetic then actual desktop viewing and Stop** on Android
T-Mobile mobile data on 2026-10-10. Native connected/stopped output and DB ended
rows corroborated. No frames saved. This is not all milestone-4 acceptance.

Important lessons:

- Coturn wildcard relay mapping translated same-server public peer to protected
  zero address: permission 403. Concrete relay address returned 200. Dynamic
  wrapper/pinned official 4.13.0 fixes mapping and mapped-loopback advisory;
  never weaken protected-peer lists. Applying original shared Compose alone
  removes the wrapper. See deployment.md/relay decision.
- Credentials are session-bound and expiring. Old grants/helpers cannot resume;
  time skew, stale browser cookie, mismatched origin or mismatched helper version
  fail closed. Re-login/re-enroll deliberately, never bypass validation.
- Trickle ICE reduced gathering wait. Candidate labels honor relay-only policy;
  peer-reflexive reporting isn't proof of direct. State connected alone isn't
  proof of decoded frames. Early socket 10053 occurred; subsequent attempt worked.
- Consent window topmost/foreground/focus has taskbar fallback and No default.
  Idle polling still delayed request arrival up to 15 seconds. 0979cd1 uses bounded
  authenticated long polling, wakes after commit, no pooled connection held,
  handled cursor, one waiter/machine, retry when previous helper is closing.
  Real HTTP/PostgreSQL regression passed; human latency retest remains.
- Helpers join kill-on-close job before receiving grants. Backend owns one DB
  session advisory lock before startup recovery; duplicate can't terminate live
  owner's grants. Dedicated ownership connection loss exits immediately. Never
  transaction-pool that connection or overlap backend instances.
- Delayed playback promise rejection previously overwrote ended state; ignore
  rejection after shutdown. UI refresh/retry discards stale navigation responses.
- Local missing MSVC linker means Windows CI is compilation evidence; unsigned
  development artifacts aren't distributable signed installers. Owner disabled
  Smart App Control for their development test; never prescribe OS bypass.
- Production lacks media secret; local/test opt-in is not deployment evidence.
  UI placeholders must remain honest. Do not implement fake signing/downloads/
  email or enable pause until capture actually stops.

Remaining acceptance procedure: for each distinct **desktop** request, record
human approval/denial, moving frames and route; test Stop, deadline, logout,
device revoke, refresh, backend restart, agent crash/restart, network loss and
lock/display loss. Confirm capture stops independently during partition and old
tokens fail, then fresh request/consent. Measure latency and sustained resources.
Use synthetic source first for transport troubleshooting; it captures no desktop.
No redundant mock suites or recording needed. Follow ordered roadmap 4→5→6→7→8.

## Consolidation receipt

PR #8 merged as d6c40c8 and PR #9 as 6d8d749. Main's later handoff documentation
was preserved. Unfinished local documentation was stashed before a new branch
from a1baf02; this supplement preserves its additional verified operational
detail. The stash and all local refs were preserved in a verified complete Git
bundle before removing the stash and already-merged local branch duplicates.
Loose root Remote/View evidence and tools were moved to restricted local archive
with source/destination/SHA256 manifest. No repository tree, registered View
worktree, database volume, secret identity or active View process was moved.
