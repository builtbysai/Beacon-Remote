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
or input; those paths do not exist yet. No production Remote deployment or signing
is claimed. Local Rust tooling was installed, but Microsoft C++ installation was
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
