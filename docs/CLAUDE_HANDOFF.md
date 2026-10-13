# Beacon Remote: Claude technical and operational handoff

**Prepared 2026-10-10.** This is a continuation document, not a statement that every feature or release gate is complete. Recheck GitHub and the actual machines before acting.

> **Superseded in part (2026-10-13).** Production now runs sessions, remote control and the dedicated relay, and the
> product has grown well past what is described below: access modes, MFA and recovery, signed updates, the native
> windows, adaptive video, the per-user installer, file transfer, guest support and email sign-up (closed until mail
> is configured). **Read `docs/roadmap.md` (status per feature) and ADRs 0021 to 0032 first**; where this
> document or the other dated validation notes disagree with them, they win. Statements below that production
> media or control is disabled, that milestone 4 is the active gate, or that features such as file transfer or
> other operating systems are out of scope are historical.

The next viewer recovery slice ends a browser request on peer loss immediately,
matching the native helper, and scopes autoplay/manual Play results to the
original session lifetime. It clears ended playback controls and preserves
terminal status and diagnostic counters. See [viewer validation](viewer-validation-2026-10-12.md)
for the delayed-promise regression, intentional old-behavior failure comparison,
and remaining actual browser/network acceptance. Do not claim milestone 4 passes
from these unit checks; production media and test fixtures remain disabled/stopped.

The viewer expiry follow-up adds an independent monotonic deadline for the
initial remaining grant lifetime. A backward clock adjustment cannot extend
local viewing; a forward adjustment still expires it. Server/native leases are
unchanged. Clock adjustment and sleep/resume behavior still need real-browser
acceptance; do not infer those results from the focused deadline regressions.

Pending desktop requests are now scoped to their original page/authentication
context. A late response after navigation or confirmed sign-out cannot reopen a
viewer, and its grant gets a best-effort Stop attempt. After logout/network loss
that attempt may fail; original server/native expiry and local consent remain.
Real browser navigation/logout acceptance is still pending.

Latest owner test, October 12: PR #25 is merged at `d0bc0b9`, with required
reviewed-head and merged-main checks passing. Matching `stop-2aa1510` binaries
passed the owner's guided Decline/Escape, Android cancel/re-request, manual
desktop viewing, local Stop and keyboard Stop checks. Both acceptance containers and the native
fixture are stopped; STOP is restored and private identity retained. The owner
cancelled the hourly automation, which was deleted. Continue only from owner
prompts; do not recreate a schedule. Production media remains disabled.

Current follow-up simplifies native consent/Stop copy and layout, aligns their
DPI-scaled fonts/system colors and displays the original deadline's remaining
time. This updated UI needs its own human appearance/navigation acceptance.
Record physical lock/expiry/recovery and performance results only when actually
observed. One-time personal-device setup is an approved product direction for
later installation/account work, not automatic approval in attended mode.
See [current consent evidence](consent-validation-2026-10-12.md) and
[access-mode direction](decisions/0014-personal-device-access-direction.md).

Latest native Stop hardening: PR #24 merged at `a68a430` after reviewed-head and
merged-main CI passed. The next resilience slice enforces the original deadline
and input-desktop boundary in the Stop window even while the browser is still
connecting, adds Enter/Escape/Tab handling and destroys the window on a loop
exit before releasing state. Local native formatting, Clippy, tests and optimized
build passed. A real noninput-desktop dispatcher regression fails with the old
timer and passes with the guard, without capture, system input or approval.
Check latest-head CI and deliberately select its matching native pair before
human acceptance. The existing acceptance backend exited cleanly at 08:12 UTC;
the native fixture remains stopped. Do not restart either merely to keep it warm.

Latest October 12 consent evidence: PR #23 merged at `fed694d`, with security,
control-plane and native jobs passing on both the reviewed head and merged main.
The existing isolated acceptance backend/web now use `00135e2` images, retaining
the one-hour backend lifetime and restricted test database/account. Schema/role,
HTTPS readiness and unauthenticated rejection passed; Remote/View production and
shared containers retained their image IDs and start times. Matching Windows
artifacts were prepared; the paired native fixture is still stopped with its
STOP marker. A native-only follow-up prevents cleanup from leaving `WM_QUIT` on
a reusable consent thread. Read [the consent validation record](consent-validation-2026-10-12.md)
before resuming; test-site readiness expires and must be rechecked. Production
media remains disabled, and no new human desktop acceptance is claimed.

October 12 milestone 4 continuation: native desktop approval now remains
cancellable while the helper reads authenticated signaling. Remote cancellation,
disconnect, expiry or loss of the input desktop closes the prompt; Decline starts
focused, and the original monotonic deadline includes setup and the person's
response. See [the consent lifecycle decision](decisions/0013-cancellable-attended-consent.md).
Real loopback cancellation/close and late-result checks use no desktop capture or
real approval. Actual Windows keyboard/DPI/lock and human viewing/Stop acceptance
remains required; milestone 4 and production media gates stay open.

October 12 publication review: the owner requested a security review before
making the source public. Read [the security review](security-review-2026-10-12.md)
for scope, findings fixed, tested boundaries and required public GitHub settings.
No live credential exposure was identified in inspected history, pull requests
or available CI logs. Hardened CI and policy changes merged in PR #14 at
`bd1c9625dcd2d56a7c8f1c92f37b3248c3050b5f`; the owner made the source public.
Secret scanning, push protection, private vulnerability reporting and Dependabot
alerts are enabled. Actions require SHA pinning, read-only default permissions
and approval for all external fork contributors. Main requires the three named
GitHub Actions checks, stale-review dismissal and code-owner approval. A separate
active `Main CI and integrity` ruleset has no bypass actors, enforcing the checks
and blocking force pushes/deletion even for administrators. The classic review
rule retains administrator bypass for the sole owner; personal repositories do
not support user-specific review bypass allowances. Verify current rules before
merging; do not remove CI requirements to get a merge through.
Microsoft C++ Build Tools/Windows SDK installation completed with owner-approved
OS elevation; local native formatting, Clippy, tests and release builds passed.
Capture now denies a noninput desktop and clears cached snapshots; actual lock,
UAC and display-loss acceptance is still pending. Production media stays disabled.

October 12 UI continuation is on `codex/remote-development`. Read
[the current visual and validation notes](visual-gap-2026-10-12.md) before
following historical design status below. The branch adds approved landing and
sign-in styling, responsive workspace navigation, pairing UI, a full-window
viewer, compact public mobile navigation, and real-data Sessions/Activity
layouts. Machine-scoped history is available in the computer inspector. The
signed-in Assist route explains the current one-time-support limitation and
links to paired computers and Windows development setup.
Local development media remains disabled. The live desktop and
populated-history interactions still require real acceptance fixtures; these
frontend changes are not a production media release.

October 12 manual production rollout: exact `74a4e6e4d6573836c3da6dfc766b4c84c90c02e7`
passed local control-plane checks and protected backup, isolated restore,
schema/role and public readiness gates. Production media remains disabled;
see [the rollout record](validation-2026-10-12.md). GitHub Actions could not
start jobs because of the account spending/payment restriction at that time.
After publication hosted jobs resumed: hardened main security and native checks
passed; a control-plane fresh-schema race required the CI follow-up described in
the security review. Local MSVC native builds now work. The remaining real
desktop acceptance matrix is still open.

Verified October 11 update: production now runs merged
`4ea7ad97eac00ca6b8b33f7c168aa34e5a2f4d28`, media still disabled, after local
validation and guarded manual rollout. PR #11 is merged. Acceptance backend
0979cd1 and diagnostic web 4324907 are running for a bounded human retest, with
matching native binaries; prior stopped-fixture statements below are historical.
See validation-2026-10-11.md for measured synthetic playback/recovery evidence and
the remaining local native compiler/desktop acceptance limits.

October 11 local continuation: [local-development.md](local-development.md)
documents isolated start/stop/status commands and the shared workstation contract.
[Verified operations supplement](local-operations-2026-10-11.md) adds the actual
SSH alias/key path, protected environment filename, observed infrastructure,
stopped fixture resumption and rollback procedures without revealing secrets.
The approved ZIP is verified locally at
`C:/Users/Saiha/Downloads/Beacon-Remote-Final-Package.zip`.
The old root acceptance runner is archived; use tracked
`node scripts/android-acceptance-host.mjs` after its explicit preparation steps.

## Source of truth and first 20 minutes

- Repo: https://github.com/builtbysai/Beacon-Remote (public source, private-alpha product); branch: `main`.
- PR #8 attended media: **merged** as `d6c40c807948a4bbc991fdc048a2699746f1d6cf`.
- PR #9 product UI/relay/backend recovery: **merged** as `6d8d7496cb87d919f0b8a7dbdb02177a816d74ae` from head `0979cd12f3371f5eabec2fbc703808eb5b53213b`. Its head passed Windows/control-plane GitHub Actions run `38083605846`. Revalidate any later commits.
- The last documented **deployed Remote release** is `ff452ffe66dd600e9a7b18d12fccc08ac970a7d6` (blue/slate private-alpha interface; **media disabled**). Repository merges are **not** production deployments. Current production commit/container state must be checked on the VM.
- Active milestone: **4, attended real desktop viewing and lifecycle/failure acceptance**. Milestones 5–8 are authorized for ordinary implementation but subject to their prerequisites.
- No unfinished local working tree can be verified from GitHub alone. On the Windows development PC check `git status --short`, local branches, ignored development fixtures and any unpushed commits before deleting or overwriting anything.
- Read `docs/roadmap.md`, `docs/security.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/windows-agent.md`, `docs/android-acceptance-2026-10-10.md`, `docs/product-interface-validation.md`, and the ADRs in `docs/decisions/`. Follow `AGENTS.md`.

**Immediate next work:** confirm the new long-poll consent-delivery behavior with matching Windows/backend artifacts; finish actual attended desktop interruption and sustained performance tests, especially denial, expiry/logout/revoke, refresh, backend/agent restart, network loss, display lock/unplug, consent focus and Stop. Capture timing/candidate-route/FPS/CPU/RAM observations without logging pixels or secrets. Never report a scenario as passed from CI or simulated media alone.

## The product and its boundaries

Beacon is a suite:

- **Beacon View**: camera monitoring/recording, a separate codebase, database and permission realm.
- **Beacon Remote**: secure, self-hosted browser-to-Windows remote access and support, initially Windows host/browser client, with direct WebRTC preferred and authenticated Coturn relay fallback.
- **Potential future**: Lighthouse-style observability plus authorized human/AI remote operations. Keep capture, snapshots, input, identity, session/control leases and policies behind transport-independent interfaces. These are now planned (see `docs/roadmap.md` phases 2 to 4); each needs explicit consent, bounded capability, visible state and immediate revocation.

Consumer journey: install host → register/sign in → pair → see online → request view → local person approves → desktop appears → separately approve mouse/keyboard control → Stop or disconnect safely. For one-time support, require scoped, expiring invitation and fresh local consent; do not imply persistent machine enrollment. No screenshot/media storage is required.

The reference products are Chrome Remote Desktop for simplicity, RustDesk for direct/relay and self-hosting, MeshCentral for inventory and management, and BeyondTrust for attended/unattended session policy and audit. Never copy vendor code or screens.

## Actual architecture (read source before editing)

```text
Browser (React/Vite) ─ HTTPS + authenticated signaling ─ Fastify backend ─ PostgreSQL
           │                                                 ▲
           │  WebRTC H.264 screen frames / future DataChannels│ signed presence,
           ▼                                                 │ one-use grants
Windows user-session Rust helper ─ local consent/Stop ─ Rust Windows agent
           │
Windows Graphics Capture → BGRA/NV12 → H.264 encoder
           │
     direct ICE / shared Coturn relay fallback
```

- `apps/web/src/main.tsx`, `Product.tsx`, `LiveView.tsx`, `ComputerInspector.tsx`, `SessionHistory.tsx`, `AccountPanels.tsx`, `api.ts`: current React UI. `product-approved.css` and `style.css`: styling.
- `apps/backend/src/app.ts`, `sessions.ts`, `relay.ts`, `backend-ownership.ts`, `config.ts`: Fastify REST/signaling, authorization, TURN grant issuance, atomic session/audit transitions and startup recovery.
- `apps/backend/migrations/`: 001 identity, 002 viewing sessions; deployment must migrate and verify schema.
- `apps/windows-agent/src/`: interactive visible Rust agent, pairing, DPAPI-protected Ed25519 identity and signed presence, bounded long-poll request delivery, native helper lifetime bound with Windows kill-on-close job.
- `apps/windows-session/src/`: user-session helper, consent/indicator/Stop, WGC capture, pixel conversion, encoder, WebRTC and renewable lease enforcement.
- `crates/remote-core/`, `packages/protocol/`: shared core and protocol types. Keep machine operations behind these interfaces rather than React component logic.
- No installed Windows service, signed installer, tray app, robust auto-updater, mouse/keyboard injection, production guest-code support or general-public account lifecycle yet. Don't imply they are complete.
- Security: one-use 5-minute pairing code; machine keys user-DPAPI; browser tokens hashed server-side, Secure/HttpOnly/SameSite strict in production; short session grants, local attended consent, independent Stop, monotonic lease expiry, account isolation and revocation. `desktop:view` does **not** grant `desktop:control`. Respect UAC, UIPI, Session 0, and Windows secure desktop.

### What evidence exists and what does not

- Local Windows PC: real WGC primary-display capture, actual H.264 Chrome viewing, attended Yes and Stop; signed presence/enrollment and expiry/revoke accepted on real Windows.
- Coturn: wildcard relay mapping caused CreatePermission 403; dynamic concrete relay address wrapper and official Coturn 4.13.0 fix passed two-sided relay/relay **synthetic** decode and local Stop. Do not revert to vulnerable Coturn or unprotected peer ranges.
- Separate network: owner confirmed synthetic and real desktop viewing plus Stop from an **Android browser on T-Mobile mobile data** on 2026-10-10. Database sessions ended and native logs showed stop. Consent dialog was slow, prompting signed long-poll delivery change; fresh measured consent timing is still needed.
- Backend: atomic grant/audit recovery, single owner advisory lock per database, shutdown behavior, helper termination on parent death and old-grant rejection have real PostgreSQL/process test evidence.
- **Not accepted for production yet**: broader unrelated external networks, denial/logout/revoke/expiry/refresh/restarts/network-loss/display-loss matrix on real devices, sustained streaming performance, media rollout, remote input, host installation and consumer account lifecycle. An isolated successful cross-network session does not cover the full matrix.
- Deployment: production remains private alpha and video/control-disabled. New commits, successful CI, and a temporary test deployment do not change that fact.
- Source details and CI references live in `docs/development-handoff.md`, `docs/validation.md`, `docs/android-acceptance-2026-10-10.md` and linked PRs.

## Development on Windows

Requirements: Node 22 (>=22.13, <23), pnpm **11.9.0**, Docker, stable Rust, Visual Studio C++ Build Tools/MSVC linker and Windows SDK for native local binaries. Earlier local `cargo check` failed for missing `link.exe`; the GitHub Actions Windows job compiled instead.

From a fresh clone:

```powershell
git clone https://github.com/builtbysai/Beacon-Remote.git
cd Beacon-Remote
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
docker compose -f infrastructure/compose.yaml up -d
```

The dev PostgreSQL listens **only** on localhost port 5433 (container database `beacon_remote_dev`). In separate shells, securely set `DATABASE_URL` and `WEB_ORIGIN` based on `apps/backend/.env.example` (startup does **not** automatically load a .env file). Then:

```powershell
pnpm --filter @beacon-remote/backend db:migrate
pnpm --filter @beacon-remote/backend dev
pnpm --filter @beacon-remote/web dev
cargo build --workspace --locked
```

Open `http://127.0.0.1:5174` (Vite proxies /api/WebSocket to `http://127.0.0.1:3010`). For initial private development account creation, set `REMOTE_ACCOUNT_EMAIL` and `REMOTE_ACCOUNT_PASSWORD` securely in the process environment, then run `pnpm --filter @beacon-remote/backend account:create`; clear the values after. Minimum password length is 16. Never put credentials in shell history or source files.

For enrollment with working backend and a generated one-use UI code:

```powershell
.\target\debug\beacon-remote-agent.exe pair
.\target\debug\beacon-remote-agent.exe run
```

When prompted, provide the backend origin `http://127.0.0.1:3010`, host name and code. The interactive `forget` command removes only this agent's local paired identity for deliberate re-enrollment. The default identity is under `%LOCALAPPDATA%\BeaconRemote\identity.dpapi` and MUST NOT be copied/shared. The session helper supports `displays` and `capture-benchmark`, which requires explicit local approval. Use matching agent/helper versions.

### Validation

```powershell
pnpm check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --release --locked
```

Set `TEST_DATABASE_URL` to a **separate** database whose name ends `_test` before integration checks; otherwise backend database tests are explicitly skipped. CI's `.github/workflows/ci.yml` uses PostgreSQL 17.6 on Ubuntu and native Rust build/test on Windows. GitHub Actions produces unsigned `beacon-remote-agent.exe` and `beacon-remote-session.exe` artifacts, currently retained for seven days. Verify SHA/CI runs, never mix native/backend protocol versions. The native acceptance test uses `NATIVE_AGENT_PATH` and a dedicated test database; see README.

## Accessing the authorized Oracle VM and production

**Do not invent a host/IP/user/key.** Current repository verifies that the VM is Oracle Cloud and has Remote deployment paths, but it does **not** record an independently verified SSH alias, public IP, Linux username or SSH key path. The Desktop Commander device available in this chat was offline on 2026-10-10. Claude must ask for an authorized SSH or desktop/OCI connection and verify exact details from OCI console, trusted SSH config or owner, without printing private key contents.

1. With owner-approved access, obtain the OCI instance public address, authorized username, host fingerprint (out of band) and SSH identity path. Example shape **only**, not an asserted working command: `ssh -i <authorized-private-key-path> <verified-user>@<verified-public-ip>`.
2. Inspect **read-only** first: `whoami`, `hostname`, `uname -m`, `df -h`, `free -h`, `sudo docker ps --format 'table {{.Names}}\t{{.Status}}'`, `sudo systemctl list-timers --all`, `readlink -f /opt/beacon-remote/current`.
3. Separate hosts/origins:
   - `https://remote.builtbysai.com`: production Remote control plane with sessions, control and relay enabled; verify live configuration before deploying.
   - `https://remote-test.builtbysai.com`: temporary acceptance origin. Its host fixture and test containers were **stopped** at handoff; do not assume currently online.
   - Beacon View remains independent but shares edge/Coturn infrastructure. Confirm its public health separately.
4. Repo-controlled deployment definition: `infrastructure/oracle/compose.yaml`; on VM releases live under `/opt/beacon-remote/releases/<sha>` and `/opt/beacon-remote/current` selects validated release. Protected Remote credentials/backups and relay overrides live under `/etc/beacon-remote/`; NEVER print .env values or rendered Compose configuration containing secrets.
5. Stack: Remote Compose project `beacon-remote`; services `postgres`, `backend`, `web`, one-off `migrate`, `verify`, and profile `backup`/`restore-check`. Backend internal port 3010, web via Caddy edge hostname `beacon-remote-web:8080`. Reverse proxy fragment in `infrastructure/oracle/edge.caddy`. Network `beacon-edge` is external shared; Remote Postgres in isolated private network 172.30.88.0/28.
6. Shared Coturn (used by View and Remote) is in the older Beacon View Compose project `beacon-secureview-cloud`; the reviewed override is `/etc/beacon-remote/turn-relay.override.yaml` and wrapper `turn-relay-entrypoint.sh`, with upstream pinned to Coturn **4.13.0** by digest. Do not apply the original View Compose alone to Coturn; it removes the fix and restores permission failure. Never relax protected peer checks. Full reviewed exact Coturn commands are in `docs/deployment.md`.

### Deployment is gated; not an automatic instruction to ship

- **Preflight:** verify owner authorization and current production commit, GitHub Action results, current database migrations, exact Remote secrets filename, control plane readiness, backup integrity, View health and available Oracle Always Free resources. Never assume old docs reflect current deployment or accept billable upgrades.
- **No overlapping backend instances** against a single Remote database. The backend holds a session-scoped advisory lock and atomically ends interrupted grants before listening. Stop old backend before replacing it. Transaction-pooled connection proxies are inappropriate for the ownership lock.
- **Build/backup:** from a validated exact commit in a new release directory, run Compose config validation with a verified root-protected env file, build the relevant production images, take an encrypted backup, run `backup check`, and if required run the documented isolated restore drill with writes quiesced. The restore target must be new and separate, never live.
- **Migrations:** explicitly run one-off `migrate`, then one-off `verify` with the same private network/validated image before starting application services. Use `docker compose run --rm` for one-offs only after checking arguments/config. Start backend then web and validate /health or /ready and actual HTTPS login/inventory.
- **Cutover/rollback:** only after approval update `/opt/beacon-remote/current`; retain prior backend/web images and deployment tree for rollback. Check `sudo docker compose -p beacon-remote --env-file <VERIFIED_ENV_FILE> -f <VALIDATED_COMPOSE_PATH> ps` and service-specific `logs --tail=100` (avoid secret-bearing logs). Roll back to **previous verified exact commit and images** if health/login fail. Do not use `compose down -v` or delete data volumes. A short Caddy 502 during container recreation was observed and recovered; don't misclassify temporary 502 as automatic success.
- **Backups:** independent Restic repository under existing private `beacon-backups` bucket, daily timer; operations include `init`, `run`, `check`, and `restore-check`. Existing script enforces 32 MiB backup dump budget, expiry policy and non-overwrite isolated restore. Verify bucket/free allocations each time.
- **Do not enable desktop media or control in production** without a reviewed release decision and the complete real-world acceptance matrix. Do not deploy an unsigned public installer. Production app updates, Caddy, database and shared TURN are consequential operations requiring explicit inspection and rollback readiness.
- Exact root-owned environment file path for Remote, SSH values, instance shape/public IP and current daemon state are **not independently verified in this handoff**; the next operator must verify them before executable production commands.

### Temporary Android mobile-data acceptance environment

See `docs/android-acceptance-2026-10-10.md` for complete bounded setup/teardown. The owner successfully viewed the Windows desktop from an Android phone over **T-Mobile cellular** and clicked local Stop. Native helper/DB reflected ended. Test host: a local runner `C:/Dev/beacon-remote-android-host.mjs`; isolated state under `C:/Users/Saiha/.beacon-remote-recovery/android-acceptance-20261010`. On Oracle, isolated sources `/opt/beacon-remote/acceptance/20261010-b1c2ae4`, Compose file `/etc/beacon-remote/acceptance-compose-20261010.yaml`, isolated web/backend containers and DB, separate acceptance Caddy fragment. They were stopped at handoff and fixture state was preserved, not production release. Before reuse verify expiration/credentials/containers, protect production, reinitialize only named fixture and obtain **fresh** approval; never silently resurrect a consent grant. Explicit local Stop and a two-minute session lease still apply.

## Approved design and UX gap

The owner-approved `Beacon-Remote-Final-Package.zip` is an **external design artifact** from the ChatGPT conversation, **not available in GitHub** unless manually attached. Ask for it and open its interactive HTML, workspace prototype, screenshots, logo assets and product prompt before design work. It includes landing, sign-in/MFA/recovery states, Windows host consent windows, device management and viewer. The design is a target, **not evidence that unimplemented functions work**.

Partial React integration exists (blue/slate tokens, brand mark, public pages, inventory search/filter, inspector/name editing, activity/session history, browser sessions, responsive themes). Remaining fidelity issues seen by owner: overly simplified landing/preview, bare sidebar and wide empty workspace, action-heavy machine rows where test video/revoke compete with Remote, missing host/tray/installer and many account/support states, layout/typography/motion inconsistencies. Track design completeness separately from backend readiness in `docs/roadmap.md`, fix UX incrementally, never ship fabricated stats/devices, and isolate synthetic/debug operations to a clearly labeled development-only control.

## Remaining ordered roadmap and acceptance

**4 — Attended media (active):** retest signed long-poll consent latency on actual PC/mobile path; real denial/Stop and revoke, grant expiry, logout, browser refresh, network loss, agent crash, backend restart, display/lock/GPU device-loss, relay/direct selection and sustained FPS/CPU/memory/latency. Fresh grant and local approval after interruption. Measure and close security/performance gates **before production view enablement**.

**5 — Authorized input:** distinct approval for `desktop:control`; one controller lease; typed WebRTC DataChannels; mouse motion/buttons/drag/scroll and keyboard/modifiers; correct DPI/multi-display coordinates; immediate held-input release on pause, loss, revoke, stop or expiry. Never inject into higher-integrity apps/UAC/secure desktop by bypass.

**6 — Windows installation/resilience:** proper least-privilege service with interactive helper, restricted IPC, visible tray/Stop, reboot recovery, signed installer, signed-update manifest and rollback, clean uninstall; needs legitimate code-signing credentials. No stealth persistence.

**7 — Consumer account:** verified signup/email, password recovery, MFA, session management, credential rotation, account deletion/retention and abuse/rate controls. Private invitation login alone is not general-public ready.

**8 — Consumer UX/release:** approved visual fidelity across public/auth/workspace/host; no mock operational telemetry; real device state; graceful offline/timeout/denial/permission/reconnect states; mobile touch and accessibility; attended guest support with scoped expiring code and explicit local consent; multi-hardware/field tests; signed distribution and deployment/rollback drill.

Keep a **separate UI status** alongside each capability: approved target, current implementation, visual gaps, real backend availability, and verified browser/native acceptance.

## Lessons learned / security warnings

- Coturn wildcard relay mapping: permissions failed with zero-address mapping; dynamic concrete-address wrapper plus patched Coturn 4.13.0. Never blindly revert the override.
- TCP/TLS TURN URLs are rejected by current native transport; only configured UDP TURN routes are accepted.
- A Chrome peer-reflexive candidate can be mislabeled Direct; diagnostics report relay-only correctly and mark ambiguous routes unavailable.
- Delayed playback failure used to overwrite a terminated session UI; client now ignores post-shutdown rejects.
- Backend duplicate startup previously risked ending live sessions; exclusive advisory ownership lock and fail-closed recovery now enforce single ownership. Real startup/subprocess checks cover failure cases, not every real restart scenario.
- Native helper was at risk of surviving agent death; non-inheritable kill-on-close Windows job mitigates it and has process-boundary evidence.
- Signed heartbeat's old fixed 15s cadence delayed host consent arrival; bounded signed long poll was implemented (see ADR 0009), but improved real-world delay still needs measurement.
- Build passing does not imply signed installer, direct/relay desktop acceptance, or actual control. Local `link.exe` absence is a tooling issue, not proof source is broken.
- Honor all privacy boundaries. Never print credentials, session SDP, screen pixels, private keys, bearer invitations or input contents.

## Handoff completion checklist

- [x] PR #8 merged to main.
- [x] PR #9 merged to main, media remains off in production.
- [x] PR #9 latest head's CI was green before merge.
- [x] Owner-confirmed one mobile-data desktop viewing + Stop scenario documented.
- [ ] Verify CI on final main/doc commits and current production health with authorized access.
- [ ] Verify local Windows working tree and SSH/OCI access details; GitHub cannot see uncommitted work.
- [ ] Confirm temporary test containers are still stopped and fixture cleanup policy respected.
- [ ] Complete remaining Milestone 4 field acceptance before media release.
- [ ] Obtain approved design ZIP if not already attached to Claude.
