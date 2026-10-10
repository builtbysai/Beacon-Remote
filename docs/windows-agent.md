# Windows agent

The current executable offers interactive `pair`, visible `run`, and deliberate
`forget` commands. Enrollment returns a stable server-issued machine UUID;
Ed25519 keys persist in `%LOCALAPPDATA%\BeaconRemote\identity.dpapi`. Reconnect
uses capped exponential backoff with jitter and request timeouts. TLS validation
is mandatory; redirects are rejected; HTTP is permitted only on loopback for
development. Windows time must be accurate for signed presence.

There is no service installation, elevated input, autostart, tray UI, remote
control, installer, or automatic updater yet. Exiting the visible agent stops
presence. Development binaries are unsigned.

The separate `beacon-remote-session` helper adds a local attended capture spike.
Run `displays` for physical dimensions/DPI, or `capture-benchmark` for a visible
consent dialog followed by ten seconds of primary-display capture with a Windows
border. Ctrl+C stops early. It reports real frame/update measurements and exercises
the in-memory snapshot interface; it saves/uploads no media. Initial real-machine capture and
deadline shutdown passed; see [measurements and remaining checks](validation.md).

The media branch now offers a two-minute primary-display view request. The native
helper requires a valid server grant, local Yes consent, a visible Stop sharing
window, a connected peer and a live renewable lease before starting WGC. No
microphone, input or recording is enabled. The synthetic video path and local
Stop passed; actual local desktop viewing acceptance also passed. Cross-network
and forced-relay acceptance remain pending. Local source now validates and passes
session-bound TURN credentials and the all/relay policy to native RTC configuration.
Use matching agent/helper and backend versions; previous helper artifacts reject
the new strict grant fields. Native compilation, Clippy and tests passed Windows
CI for `543988f`; local MSVC `link.exe` remains unavailable. UDP TURN is supported;
TCP/TLS TURN is rejected because the current RTC driver skips those transports.
Browser-only forced-relay synthetic decoding and Stop passed on this Windows PC,
with an existing Tailscale route on the native side. Dual-relay and distinct-public-
network desktop acceptance remained unresolved at that point. The later concrete
relay-address fix passed dual-relay synthetic decoding with relay/relay selected;
distinct-network desktop acceptance is still pending. Native diagnostics expose state names
and lease-expiry reasons only, never grants, SDP or candidate addresses.

Development helpers now belong to an unnamed, non-inheritable Windows job with
kill-on-close. Assignment precedes sending the grant through stdin and fails
closed. Windows terminates helpers if the agent is forcibly stopped, even when
Rust cleanup cannot run. Existing consent, visible Stop and monotonic leases
remain required. A native process-boundary check verifies job-close termination;
Windows CI formatting, Clippy, process-boundary tests and release build passed at
`e111946` in [run 38078446154](https://github.com/builtbysai/Beacon-Remote/actions/runs/38078446154).
The matching agent/helper then decoded synthetic video over relay/relay through
patched Coturn 4.13.0. Forcibly terminating only the fixture agent also terminated
its observed helper process; Chrome showed Session ended, PostgreSQL stored ended,
and reconnecting the old browser grant returned 403. No desktop was captured.
No service, privilege escalation or job breakaway is introduced.

Next measure streaming FPS, memory/CPU, acquisition latency, DPI,
rotation, cursor, desktop lock, display disconnect and device loss on real Windows.
Protect Windows Session 0/UAC/UIPI; do not capture secure desktop or inject into
higher-integrity windows by bypassing protections.

The later signed MSI should install a least-privilege service and interactive
helper, create restricted IPC, offer pairing/status/clean uninstall, and use
Service Control Manager recovery. Secure updates need a signed manifest, pinned
publisher identity, digest verification, downgrade protection, staged atomic
replacement and rollback. The owner must supply legitimate Windows code-signing
credentials before distributing signed installers. Never fake signing or instruct
users to bypass SmartScreen. No signing credentials belong in Git.
