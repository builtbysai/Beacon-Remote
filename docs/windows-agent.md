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

The agent opts into a bounded signed-heartbeat long poll for pending requests.
The backend wakes it after a new request commits, rather than waiting for the old
15-second sleep. A handled-request cursor suppresses redelivery while consent is
open, and the next distinct request wakes immediately. The server waits at most
15 seconds outside the database pool; the client request timeout is 25 seconds.
Older or media-disabled backends retain the 15-second polling fallback. Network
failure still uses bounded backoff. Consent follows authenticated signaling;
no capture starts merely because a notification arrives. See
[the request delivery decision](decisions/0009-prompt-request-delivery.md).

The separate `beacon-remote-session` helper adds a local attended capture spike.
Run `displays` for physical dimensions/DPI, or `capture-benchmark` for a visible
consent dialog followed by ten seconds of primary-display capture with a Windows
border. Ctrl+C stops early. It reports real frame/update measurements and exercises
the in-memory snapshot interface; it saves/uploads no media. Initial real-machine capture and
deadline shutdown passed; see [measurements and remaining checks](validation.md).

The media branch now offers a two-minute primary-display view request. The native
helper requires a valid server grant, local Allow viewing consent, a visible Stop sharing
window, a connected peer and a live renewable lease before starting WGC. No
microphone, input or recording is enabled. The synthetic video path and local
Stop passed; actual local desktop viewing acceptance also passed. The owner later reported Android/T-Mobile forced-relay desktop viewing and Stop; the complete interruption and sustained-performance matrix remains pending. Source validates and passes
session-bound TURN credentials and the all/relay policy to native RTC configuration.
Use matching agent/helper and backend versions; previous helper artifacts reject
the new strict grant fields. Native compilation, Clippy and tests passed Windows
CI for `543988f`; Microsoft C++ Build Tools and the Windows SDK are now installed locally; see the latest security review for current native validation. UDP TURN is supported;
TCP/TLS TURN is rejected because the current RTC driver skips those transports.
Browser-only forced-relay synthetic decoding and Stop passed on this Windows PC,
with an existing Tailscale route on the native side. Dual-relay and distinct-public-
network desktop acceptance remained unresolved at that point. The later concrete
relay-address fix passed dual-relay synthetic decoding with relay/relay selected;
the later Android/T-Mobile desktop report covers one distinct-network session. Native diagnostics expose state names
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

The attended capture path now denies consent/startup and clears cached frames
when Windows reports that the helper's desktop no longer receives local input.
Query failure also stops sharing. Unlocking never resumes an old request. See
[the desktop availability decision](decisions/0012-attended-desktop-availability.md)
for the OS-boundary regression and remaining real lock/secure-desktop acceptance.

Pending desktop requests now use a cancellable native approval window with
Decline focused by default. The helper keeps reading signaling while the person
decides; cancellation, disconnect, expiry or input-desktop loss closes the
prompt. Connection setup and the response share the original two-minute
monotonic deadline. Late approval cannot revive an ended request. See
[the consent lifecycle decision](decisions/0013-cancellable-attended-consent.md)
for protocol verification and the remaining actual Windows checks.

The matching helper can retain that original approval through a short browser
reload. It destroys the previous peer/capture worker and waits with visible Stop
for the original browser login, without extending the two-minute deadline.
Each media cycle owns its connection flag, so late callbacks from a closed peer
cannot authorize capture by its replacement. Local Stop gates both capture and
queued frames across cycles. Lock, expiry, revocation, missed renewal and restart
still terminate. See [ADR 0015](decisions/0015-active-viewer-reload-recovery.md);
actual matching Windows/Android reload acceptance remains required.

The later signed MSI should install a least-privilege service and interactive
helper, create restricted IPC, offer pairing/status/clean uninstall, and use
Service Control Manager recovery. Secure updates need a signed manifest, pinned
publisher identity, digest verification, downgrade protection, staged atomic
replacement and rollback. The owner must supply legitimate Windows code-signing
credentials before distributing signed installers. Never fake signing or instruct
users to bypass SmartScreen. No signing credentials belong in Git.
