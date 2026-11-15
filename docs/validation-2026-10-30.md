# Unattended access follow-up — October 30, 2026

Branch: `codex/unattended-access`. Local changes only; no commit, push or
deployment. This continues the authorized unattended milestone. The broader
implementation and hardware acceptance limits are in
[the October 29 record](validation-2026-10-29.md).

## Changes

Inventory and session admission now share one SQL readiness rule. Fresh locked
or signed-out boot reports override a recent desktop heartbeat for owner,
remembered-helper and one-time support-code connections. Rejected support
requests preserve the code. Expired boot reports no longer block a fresh host,
and boot presence never makes an absent interactive host available. Existing
endpoints without boot services retain their normal behavior. This does not
replace endpoint lock/secure-desktop enforcement or change restart authority.

Windows `forget` clears local owner/control/helper/file standing permission
before removing the pairing's boot service and identity. Administrator cleanup
failure preserves the identity for retry while leaving local permission off.
This prevents a replacement pairing in the same Windows profile from inheriting
the previous pairing's standing permissions. Revoke in the workspace and stop
the old host before deliberate re-enrollment.

## Subsequent boot/restart requirement

The owner clarified that completion requires reconnect after restart, control
of the initial Windows sign-in screen and optional startup at boot. ADR 0048
records this expanded target. Sign-in-screen control remains unimplemented;
the current service continues to report presence only.

Boot presence is now independently optional in the local host. Ordinary trusted
owner setup enables the host at sign-in without installing that service or
asking for administrator setup. The boot checkbox reads the actual SCM
automatic-start configuration. Changing it does not restart a stopped host.
Turning off unattended attempts local service removal even if lowering server
policy fails. No system service or machine reboot was performed here.

The restart confirmation now offers automatic reconnect. It waits for a new
signed host process or an offline/online transition and obtains a fresh
policy-approved session. The original capability and selected display are
preserved. Cancellation, navigation, sign-out or newer manual connection intent
invalidate pending recovery; late grants are stopped. Recovery cannot silently
fall back to an attended prompt. It has a ten-minute monotonic deadline and
does not persist through a browser reload. Current hosts still need sign-in.

Migration 024 adds the nullable host-process marker. Canonical heartbeat domain
v2 signs it; v1 remains supported without it. Database regressions passed for
marker substitution/stripping rejection, exact pre-restart instance reporting,
fast host-instance replacement, and policy-only session admission/rollback.
Browser recovery regressions passed for fast restart, older hosts, lock state,
network failures, cancellation, expiry, removal and permission lowering. Schema
verification passed with migration 024 on the actual Remote test database.

Native formatting/Clippy/tests/release build passed after these endpoint changes.
The matching real-process fixture passed, including restart of its own agent
while preserving pairing, changed signed process marker, optional boot startup
remaining disabled, reconnect offers and local revocation during policy outage.
It did not restart Windows or exercise the privileged sign-in desktop. Browser
UI and actual reboot acceptance remain open.

## Validation

Real PostgreSQL route regressions passed for signed locked/signed-out/unlocked
reports, expired boot reports, absent desktop presence and optional-service
absence. They exercise owner inventory, helper inventory and each session-entry
path, including support-code preservation. No desktop capture is needed for this
database boundary check.

`pnpm check` passed with Remote's actual `_test` PostgreSQL database: formatting,
lint, type-checking, script/backend/web regressions and backend/web builds. The
final fixture edits also passed focused backend type-checking and lint. Final
changed-file formatting and `git diff --check` passed. Vite emitted a plugin
timing advisory; the build succeeded. An initial focused route run stalled and
was stopped; its bounded rerun and the full suite passed.

`scripts/Test-RemoteCi.ps1 -NativeOnly` passed Rust formatting, Clippy with
warnings denied, workspace tests and the optimized Windows workspace build.
No administrator service installation was performed.

The expanded `trusted-e2e.ts` fixture passed against matching release binaries
with `E2E_LOCAL_REVOKE=1` and `E2E_HOLD_SECONDS=2`. Actual native processes and
DPAPI profile state exercised policy connection without clicking Allow, media
offers, reconnect, immediate local shutdown despite the policy endpoint returning
503, independent attended/helper behavior, server revocation, forgetting and
re-pairing with owner/helper standing permission off. The short hold is not soak
testing. This fixture has no browser decoding, real remote input or cross-network
route proof. It creates no Windows service. Its processes and isolated database
schema were removed by the fixture; generated profile state remains ignored.

Android source was unchanged in this follow-up. Its previous build/emulator
evidence remains in the October 29 record; physical-phone acceptance is pending.

## Release gates

The owner's subsequent clarification requires initial Windows sign-in-screen
control and full optional boot startup. That privileged endpoint remains
unimplemented. It is a development requirement, not just a hardware acceptance
gate. See [ADR 0048](decisions/0048-boot-login-and-restart.md).

Windows administrator service installation, repair, reboot and uninstall still
need acceptance on the designated second PC. Physical Android and real remote
network capture/control/file acceptance remain open. Nothing in these local
checks proves those gates. Production remains unchanged.
