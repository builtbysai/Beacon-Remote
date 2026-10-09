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
the in-memory snapshot interface; it saves/uploads no media. Capture is not wired
to enrollment or exposed to remote viewers. Real-machine acceptance is pending.

Next build an attended capture helper with explicit screen selection and a visible
Stop control. Measure primary-display FPS, memory/CPU, acquisition latency, DPI,
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
