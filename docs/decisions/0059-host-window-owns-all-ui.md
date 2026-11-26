# The host window owns all local UI

Status: decided by the owner ("move all UI into the host window"), 25 November 2026. Implementation staged; see
"Status of the work" below.

## Decision

- The Windows host (`beacon-remote-host.exe`, one process, one window) draws every piece of local UI: setup and pairing,
  the connection request, the sharing card with Stop, requests for more access, settings.
- The capture helper (`beacon-remote-session.exe`) becomes headless. It no longer creates a consent window or a Stop
  window. It reports what it needs the person to decide, and what is happening, to the host over its private pipes, and
  acts only on answers that come back on the same pipe.
- One window: the host window shows the request, then the sharing card in place. While a session is live the window is
  always on top and cannot be minimized or hidden; it can be collapsed to a compact bar that keeps Stop and Pause.

## Why

Two windows from two programs could not behave as one, and the old design kept the person's last view hidden or in the
way. The helper is also the program that talks to an untrusted viewer over WebRTC and handles its data. Putting the
consent and Stop controls in the host, which only talks to the server, means the program exposed to the viewer no longer
draws, or can fake, its own consent screen.

## Pipes and messages

The host already owns an anonymous stdin pipe to each helper (no discoverable endpoint). Two things are added:

- **helper to host**: the helper's stdout is a pipe the host reads; it carries one JSON object per line and nothing else
  (diagnostics go to stderr). Lines are limited to 4 KiB and untrusted text is sanitized before it is drawn.
  `prompt` (a request that needs an answer: its id, kind `first` or `more`, who asks, session label, display, whether
  control was asked, scope and detail text, the deadline), `withdraw` (the request is no longer pending), `state`
  (a full snapshot: connected, control, files, recording, audio, paused, muted, note, time left), `ended`.
- **host to helper**: after the grant line, stdin carries one JSON object per line: `answer` (prompt id, allow, and the
  choices made: control, files, recording, audio), `stop`, `pause`, `mute`, `revoke-extras`, `send-file` (a path the
  person picked in the host), and `alive`.

## Invariants (all enforced in the helper, none depend on the host being correct)

1. Nothing is approved without an `answer` whose id matches the one pending prompt, `allow` true, received before the
   deadline, while the helper's own checks still hold (the request is pending, the grant has not expired, the input desktop
   is the one being captured). Anything else, including a malformed line, an unknown id or a duplicate, declines.
2. Decline is the default everywhere: no host, no `alive`, a closed pipe, the deadline, withdrawal, a lock or a
   desktop change all decline and, for a first request, end the session with nothing captured.
3. **Liveness lease.** The host sends `alive` from its UI thread every second. If the helper has no `alive` for five
   seconds (and before the first one, for five seconds from start) it stops capture and input and ends. A hung or dead host
   window therefore cannot leave a screen shared with nobody able to press Stop. A pipe EOF stops at once, as before.
4. Stop, Pause, Mute, revoking file and recording access, and ending from the viewer work whether or not the host
   window is responsive to anything else; `stop` and EOF also fail closed. Stop is never behind another click.
5. The helper never sends text the host would act on: `state` and `prompt` are display only. Sending a file needs a
   path chosen in the host, files permission granted for this connection, and an unpaused, connected session; the helper
   checks all of that again.
6. A headless agent (no host window, such as `beacon-remote-agent run`) has no one to answer: requests decline and
   sessions end after the lease window. Trusted access is not an exception, because the sharing card must exist.
7. The first prompt still shows who is asking, what they would see and do, View only versus Control, the optional file,
   recording and sound choices, defaults to Decline, and expires without an answer, as in ADR 0029.

## Trade-offs

- The host process is now part of the consent path. It is the same user and integrity level as the helper and already
  holds the identity and starts the helper, so no new authority is created; its liveness is made a condition of sharing
  (invariant 3) rather than assumed.
- One window means a session replaces the home screen while it is live; when it ends the home screen returns.
- The old consent and indicator windows, their window classes (`BeaconRemoteVisibleStop`) and tests are removed. The
  hidden-desktop tests are replaced by bridge tests (answers, deadline, lease, forged and duplicate answers).

## Status of the work

Stage 1 (this ADR's first change): protocol, headless helper, the host window's request and sharing screens on a new
small layout toolkit, liveness lease. Stage 2: the home, pairing and settings screens move onto the same toolkit.
