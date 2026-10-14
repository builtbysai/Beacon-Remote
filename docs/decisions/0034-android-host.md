# 0034: Android as a host (view only)

Status: accepted, 2026-10-13

## Context

Remote support often starts with a relative's phone. The Windows host is reliable, so Android is the next host.
Android gives an app no silent way to capture the screen, which fits the product's rule that capture is always
visible and approved by the person holding the device.

## Decision

- **A separate native app, `apps/android-host`** (Kotlin, plain Android views, libwebrtc from `io.github.webrtc-sdk`).
  It is not part of the Beacon View camera app, shares no credentials with it, and talks to the same Remote backend
  and signaling protocol as the Windows host.
- **Pairing** uses the same one-use enrollment code as Windows. The app makes an Ed25519 key, seals the seed with an
  Android Keystore key, and signs heartbeats with it. Backup and device transfer are switched off for the app's data.
- **Availability** is a foreground service (`specialUse`, a persistent "Beacon Remote is available" notification)
  that sends the signed heartbeat. A request to see the screen becomes a high-priority notification and a full
  screen intent.
- **Consent is the phone's.** Nothing is captured until the person taps Allow once in the app and then accepts
  Android's own screen-capture prompt. Declining, closing, or two minutes passing tells the server no.
- **After a restart** the phone becomes available again only if it was left available: "Stop being available"
  clears that choice, and so does removing the phone from the account.
- **Sharing** runs in a second foreground service (`mediaProjection`) with a public notification that always offers
  Pause and Stop, plus Android's own sharing chip. Pause turns the video off and tells the viewer; Stop ends the
  session. The lease is the same as Windows: numbered challenges every second, sharing ends unless a reply to one
  sent within three seconds arrives.
- **Control is not offered.** A request for `desktop:control` is shown as "they can only watch". Remote control
  needs an AccessibilityService, which Android restricts and Play reviews hard, so it is a later, separate decision.
- **No cleartext traffic** in release; debug builds may use `http://10.0.2.2` to reach a local fixture.

## Honest limits

- Verified on the Android 16 emulator, relayed through a local TURN server; not yet on a real phone, a locked
  screen, or mobile data. The emulator cannot reach the browser directly because the browser hides its addresses
  behind mDNS names, so a relay is needed there; real phones on a home network resolve them.
- Audio and control are not done. The app is unsigned debug-only until a release key is chosen.
- Not published for download yet.
