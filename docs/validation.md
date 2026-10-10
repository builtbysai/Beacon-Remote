# Development validation — October 9, 2026

Identity/presence passed formatting, ESLint, TypeScript, backend/web builds, and
real PostgreSQL checks for authentication, origin rejection, one-use/expired
pairing, signed presence, forged/replayed heartbeat rejection, account isolation,
offline expiry, revocation and audit persistence. Dependency audit is clear after
updating Fastify to its patched release.

[Windows CI](https://github.com/builtbysai/Beacon-Remote/actions/runs/38001463793)
passed Rust formatting, Clippy with warnings denied, tests including Windows DPAPI
tamper rejection, and the release build. Its unsigned development agent was then
downloaded and run on the actual Windows host through
`apps/backend/scripts/verify-native-presence.ts`. That test exercised real HTTP
and PostgreSQL, a separate temporary user-state directory, and a random test
account. It verified native enrollment, DPAPI persistence, signed online presence,
an actual backend stop/restart, expiry to offline after killing the agent, and
termination after server revocation. It removed only its own account and state.

The browser was manually validated through local sign-in and the real database
inventory, including the revoked-access state. This is not proof of desktop media
or input; those paths do not exist yet. Signing and production owner login/pairing
are not yet verified. Local Rust tooling was installed, but Microsoft C++ installation was
canceled; CI supplied the native executable for this acceptance check.

The attended capture helper passed Windows CI formatting, Clippy, workspace
tests and release build in [the capture run](https://github.com/builtbysai/Beacon-Remote/actions/runs/38003097627).
Its executable enumerated the actual primary display as 1920×1080 physical pixels
at origin (0, 0), DPI scale 1.50. After the owner accepted the local dialog, the
ten-second benchmark captured a real 8,294,400-byte BGRA snapshot in memory.
Observed compositor update rate was 22.88 FPS, first-frame latency 170.94 ms,
mean GPU readback/copy 4.29 ms, peak process working set 65.08 MiB and sampled
total process CPU time 1.031 seconds. These are measurements of this host and
window activity, not an encoded video cadence or a remote latency claim.
Capture stopped at the deadline; no frames were saved or uploaded. Manual Ctrl+C
shutdown, consent rejection, display removal and GPU/device-loss recovery remain
unverified. WebRTC encoding/transport and input are not implemented by this slice.

The Oracle control-plane packaging was validated locally before deployment:
both production Docker images built, PostgreSQL initialized a separate restricted
app role/database, compiled migration and schema/role verification passed,
backend readiness and the private Caddy route worked, and real HTTP login,
Secure/HttpOnly/Strict cookies, authenticated inventory and CSP passed. Runtime
backend/frontend use non-root users, read-only filesystems and dropped capabilities.
The first hardened Caddy startup failed because the vendor binary carried an
unneeded port-binding file capability; removing it at build time fixed startup
without granting runtime capabilities. An early test invocation bypassed database
readiness and was refused; rerunning with Compose's health dependency passed.
Only the named disposable hosting-test containers, volume and network were removed.

Real database login-limit integration now checks forwarded-IP spoof rejection
outside the trusted proxy CIDR and separate client limits through that proxy.
The subsequent ARM64 host deployment passed public HTTPS health/readiness,
encrypted OCI backup, full repository integrity and isolated restore verification.

The backup image also passed local real PostgreSQL/Restic acceptance with a
fixture account: encrypted repository initialization, completed dump, encrypted
backup, integrity read verification, a fresh separate-database restore,
schema/aggregate comparison and owned-target cleanup. A pre-existing verification
database was deliberately created; the restore refused it and left it intact.
The disposable test PostgreSQL and repository were cleaned up. The later host
drill also passed; its independent daily timer is enabled.

The operator invitation integration uses real PostgreSQL to check expiry, exact
Origin rejection, atomic concurrent claims, replay rejection and login with an
Argon2-protected owner-chosen password. Local formatting, lint, type checking,
production compilation and database integration passed before review.

Production runtime release `2c8f944c5e44ff765baa1671a70ea9202b9b688c`
passed the real Windows agent path over `https://remote.builtbysai.com`: a temporary
invited account, password login with Secure/HttpOnly/Strict cookies, native
enrollment, user-DPAPI identity, signed online presence, stopped-agent offline
expiry, restarted-agent presence, and server revocation terminating the process.
Only that acceptance account, invitation and isolated temporary local identity
were removed. This test captured no screen content and proves no video/input path.
The owner's separate setup page is open for direct credential entry.

The first operator CLI invocation caught an omitted production-build include;
the manifest was corrected and the compiled CLI was verified inside the ARM64
runtime image before this acceptance passed. Scheduled backup now uses `--no-deps`;
the actual systemd job succeeded and preserved the live PostgreSQL container ID
and start time. Both products still pass public health/database readiness, and
the Remote-only daily timer remains active. Its restored-database drill passed
before owner setup was opened, while writes were quiesced.
