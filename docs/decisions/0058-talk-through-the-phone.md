# Talking through the phone

Status: decided by the owner ("build it"), 21 November 2026.

## Decision

- A trusted viewer with control can press **Talk through phone** to speak through the phone's speaker, for example to
  tell the person holding it what is about to happen during remote support.
- The phone's owner has one switch for it, **Talk through this phone**, in the Privacy tab. It is off in a fresh
  install. With the switch on, no further step is needed on the phone.
- It never plays while the phone is locked: the phone refuses the request ("locked") and stops at once if the phone
  locks mid-sentence. Pause, Stop, a lost viewer or turning the switch off also end it at once.
- The sharing notification says "Someone is talking" for as long as the speaker line is open.
- Nothing is recorded or saved on the phone. The viewer's microphone is opened by the browser only after the person at
  the viewer presses the button and the browser's own microphone prompt is accepted.

## How it works

The phone adds one receive-only audio line to its offer, only when the switch is on and the session has control. The
line's incoming track is muted. The viewer finds that line in its answer, and on **Talk through phone** attaches its
microphone to it, then sends `{ type: "talk", on: true }` on the input channel. The phone unmutes the track only if the
switch is on, the phone is unlocked and sharing is not paused, and answers `{ type: "talk", state }` with `on`, `off`,
`locked` or `disabled`. The viewer shows the answer in words and stops its microphone on anything but `on`.

## Why

The owner's trusted access means the owner's own account may use the phone as if holding it (ADR 0055, 0057). A
visible notification, one switch and the lock rule keep this honest: the person holding the phone can see and stop it,
and it cannot be used to speak into a phone that is sitting locked and unattended.
