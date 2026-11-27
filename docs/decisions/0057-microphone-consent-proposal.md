# Microphone

Status: decided by the owner, 20 November 2026 (replaces the earlier proposal, which recommended a per-request
permission and never unattended).

## Decision

- A viewer with trusted access can hear the phone's microphone, including in unattended sessions and while the phone
  is locked. There is no per-request prompt and no time limit beyond the session itself.
- The phone's owner keeps one switch for it on the phone ("Microphone for trusted viewers"). It is off in a fresh
  install, because a microphone that nobody turned on is the wrong default for a phone that is not the owner's test
  phone, and the owner turns it on once. With the switch on, no further step is needed.
- The sharing notification says "Microphone is on" for as long as the microphone is open, and Android's own microphone
  indicator shows as well. Pause and Stop end it at once.
- If an attended share also shares the phone's playback sound (ADR 0054), the two are mixed into one track.
- The viewer's microphone to the phone (talking to the person holding it) is a separate decision.

## Why

The owner chose trusted access to mean the owner's own account may use the phone as if holding it, including hearing it.
The one switch and the visible notification keep that choice reversible and honest.

## Tests needed before it counts

Pixel: microphone sound reaches the viewer in an unattended session with the phone locked; the notification line shows;
switch off silences it; Pause and Stop end it.
