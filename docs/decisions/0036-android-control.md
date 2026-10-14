# 0036: Controlling an Android phone

Status: accepted, 2026-10-14

## Context

The Android host (ADR 0034) lets a helper watch a phone. Helping with a phone usually means touching it: opening
Settings, tapping a button, typing a value. Android gives an app no silent way to do that. The one supported way
is an accessibility service, which the person must turn on themselves in Settings.

## Decision

- **Same channel, same envelopes.** Control uses the `beacon-input-v1` data channel and the envelope the viewer
  already sends a Windows computer (version, session id, lease id, rising sequence, one input; at most 2 KB and 500
  messages a second). The phone creates the channel before its offer, as Windows does, and its first message is the
  screen size with `"platform":"android"`, which the viewer uses to show phone controls.
- **The mapping is deliberately small.** Mouse down, move and up become one touch gesture (a tap, a long press or a
  swipe, dispatched when the button is released); the mouse's right button is Back; the wheel becomes a swipe;
  typed text and US-layout keys are added to the focused text field, Backspace deletes, Enter is the keyboard's
  Enter action; Home, the arrows and Page Up/Down map to Home and scrolling. Shortcuts with Ctrl, Alt or the Windows
  key are dropped. A new `nav` input (Back, Home, Recents, Notifications) is sent only by the viewer's phone
  buttons, which appear only when the phone identified itself as Android. The clipboard is not readable by a
  background app on Android, so a clipboard read is answered "unavailable".
- **Two consents, both the person's.** The accessibility service is off until they turn it on in Settings (the
  request screen explains this and links to it). Even then, each request that asks for control shows an unticked
  box, "Also let them touch and type on this phone"; the viewer is told "view only" otherwise. The service ignores
  everything unless a session with control allowed is calling it, and its settings description says so.
- **Visible while it happens.** The sharing notification says "Sharing and being controlled" and always offers
  Pause and Stop; Android shows its own sharing chip. Pause stops all input. Malformed or out-of-sequence input,
  a viewer silent for 1.5 seconds (touches let go) or 30 seconds (control ends), a lost lease or Stop all end
  control; a malformed message ends control but leaves the picture running.
- **No new server behaviour.** The server already relays a control request and the phone's `control: false` answer.

## Honest limits

- This is for helping a person with their own phone, with them present. Android restricts accessibility services
  for apps distributed through Google Play; this app is not published there.
- A drag is delivered as one gesture when the button is released, so it feels laggy for fine dragging. Pinch,
  multi-touch, other languages' keyboard layouts, and typing into secure fields (passwords) are not supported;
  Android also hides some screens from accessibility services.
- Verified on the Android 16 emulator only, with the accessibility service switched on through adb.
