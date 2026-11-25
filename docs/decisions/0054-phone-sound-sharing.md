# Phone sound sharing

A viewer of an Android phone could see and control it but not hear it. This record sets when the phone's own sound is
shared and what is never shared.

## Decision

- The phone's owner turns on "Share phone sound" in the Beacon app. It is off by default and needs Android's
  sound-recording permission, which the app asks for when the owner turns it on.
- It applies only to an attended share, where the owner approved the request and Android showed its own screen-capture
  confirmation. Unattended access does not share sound: it has no screen-capture grant, and the app says so.
- What is shared is what apps play (media, games, unclassified sound). Calls, notification sounds and apps that mark
  their sound as not capturable (for example the Chrome browser) stay private. This is Android's rule and is not worked
  around.
- The microphone is never shared. WebRTC's audio module opens the microphone, so every buffer it reads is cleared before
  anything else and then replaced with the captured playback sound or with silence. A failure can only produce silence.
- Pause stops the sound with the picture. Stop and the end of the connection release the capture.
- The sound is sent without echo cancelling, noise suppression, gain control or high-pass filtering, because it is not
  speech.
- The viewer keeps the sound muted until its person turns it on, as browsers require.

## Why

Sound can reveal private things (a call on speaker, a video). Making it an explicit owner setting, off by default, and
tying it to an approved attended share keeps the screen-sharing consent honest. Android's mic indicator may show while
sound is shared, because the audio module holds the microphone open; the app's text says the microphone itself is never
sent.

## Checks

Pixel, 19 Nov 2026, attended share with sound on: a 440 Hz tone played by the system media player reached the viewer
(Web Audio peak 0.37, the tone's amplitude 12000/32768). The same tone in Chrome was not captured, as Android requires.
Not yet tested: a long session, Pause with sound, microphone silence while sound is idle, and other Android versions.
