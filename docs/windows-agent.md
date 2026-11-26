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

## One window (November 25, 2026)

The host shows one window. The Windows sign-in settings are a page inside it (Back returns), and a second launch brings
the open window forward instead of showing a message box. The temporary support program is a separate mode for a
different person and keeps its own window.

During a session the same window is the only window ([ADR 0059](decisions/0059-host-window-owns-all-ui.md)). The
capture helper (`beacon-remote-session media-host`) is headless: it draws nothing and reports what the person must
decide and what is being shared as one JSON line per message on its stdout (at most 4 KiB: `prompt`, `withdraw`,
`state`, `ended`). The host reads them (`session_hub.rs`), shows them as a page inside its window (`session_view.rs`),
and writes the person's answers on the helper's stdin (`answer`, `stop`, `pause`, `mute`, `revoke-extras`, `send-file`,
`alive`). The helper's ordinary output goes to stderr, so the protocol channel carries nothing else. The wire format and
the helper's side are `ui_protocol.rs` and `ui_bridge.rs`; the old consent window and sharing card are gone.

Invariants, covered by `ui_bridge::tests` and `ui_protocol::tests`; the host only sends messages, the helper decides:

- An answer counts only for the one pending prompt id, only the first answer, only with `allow` true, before the
  deadline, while the request is still pending, the grant has not expired and the input desktop is the shared one.
  Anything else, including a forged or repeated id, declines.
- Decline is the default answer: it is the focused button. Escape or Enter with nothing focused declines and never
  stops sharing.
- A malformed or oversized line, end of input, or Stop fails closed and ends the session.
- Liveness lease: the host sends `alive` from its own UI thread; the helper ends if none arrives for 5 seconds (5 seconds
  of startup grace), so a hung or killed host cannot leave the screen shared. Run standalone with no host, requests
  decline and no session starts.
- Stop, Pause, Mute and turning off extras are never behind another click. The window stays on top while a request or
  share is open and cannot be closed or minimized then; the closing control is Stop sharing.
- One request at a time; a second is declined. The request screen shows who, what, View only or View and control, the
  optional file, recording and sound choices, Decline and Allow once, and no Stop because nothing is shared yet. Once
  allowed it becomes the sharing screen in place; more access asked during a share is shown under Stop.

Checked on the Surfiena lab laptop on November 26, 2026: request screen and all options, sharing screen, Mute and turn
off extras, and the helper ending within two seconds of the host being killed. Not yet exercised there: input from
the viewer through the new path, file send, recording, and the five-second lease timeout of a hung (not killed) host.

## Look of the native windows (November 25, 2026)

The host window (including its request and sharing screens), the sign-in page and the support window share `native_ui.rs`, so one set of tokens drives
all of them, following the web direction: cool-neutral window, soft tiles with no hairlines, pill buttons (ink for the
main action, a soft tile for the rest, a coral wash for danger), tinted capsule status and the monitor character in
the header (awake with signal arcs when reachable, asleep when stopped, surprised when someone is knocking). Dark mode
and high contrast keep the same structure; high contrast falls back to system colours.
