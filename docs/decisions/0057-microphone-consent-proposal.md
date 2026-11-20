# Microphone (proposal, not decided)

Status: proposed, 20 November 2026. Needs the owner's yes before any code. ADR 0054 covers the phone's playback sound.

## Question

Should a viewer be able to ask to hear the phone's microphone, or to speak to the phone?

## Recommendation

Phone microphone to the viewer: yes, but only as a per-request permission, never as a standing setting and never
unattended. Viewer microphone to the phone: not yet.

- Same pattern as recording (the viewer asks, the phone shows "Allow this viewer to hear your microphone?" with
  Decline and Allow). The grant ends with the connection. Pause and Stop end it at once.
- Never in unattended sessions, and never while the phone is locked, because nobody is there to see the prompt and
  Android's microphone indicator is the only other sign.
- A visible "Microphone is on" line in the phone's sharing notification for as long as it is open.
- Technically this reuses the audio track from ADR 0054 with the real microphone as the source instead of the
  replacement buffer; it must never mix with playback sound unless both are allowed.
- The viewer's microphone to the phone (talking to the person holding it) needs a playback path and echo handling on
  the phone; it is a separate decision after this one works.

## If the owner says no

The phone's microphone stays unused by Beacon, as today. Nothing else changes.

## Tests needed before it counts

Pixel: request, decline and allow; sound reaches the viewer; Pause and Stop end it; an unattended request cannot
ask for it; the notification line shows while it is on.
