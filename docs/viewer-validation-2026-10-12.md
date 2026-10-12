# Viewer interruption and playback lifetime — October 12

## Problem and implementation

The native helper already ends its lease on a disconnected, failed or closed
peer. The browser previously retained an eight-second timer and said it was
reconnecting. The viewer now ends the same request immediately and tells the
person to request viewing again. It pauses/detaches the video and removes the
Play prompt. The terminal reason appears in the stage even after decoded frames
were received; diagnostic counters remain available.

The explicit Play handler previously applied its promise result without checking
whether Stop, expiry, unmount or grant replacement had ended the request. Both
autoplay and manual retry now use the same original-session lifetime guard.
Successful live retry clears the Play prompt and restores connected status;
late success/failure cannot change an ended session or start an ended playback
attempt. Authorization, signaling, native capture/consent/Stop, renewable leases
and server expiry are unchanged. This is not automatic reconnect or stored
desktop consent.

## Regression and validation scope

The focused delayed-playback regression and web type checking passed locally.
It exercises actual deferred JavaScript promises settling after the original
session is ended, plus a blocked live attempt followed by manual retry and
refusal to start a later ended attempt. Removing the post-await lifetime guards
in an ignored comparison copy makes the regression fail because the delayed
result changes `Stopped` to `Playing`; the tracked guarded implementation passes.
This is an intentional negative comparison, not a failed current-source check.

The web package now runs these regressions through the same pinned `tsx` and
Node types already used by the backend, and `pnpm check` includes them. No new
resolved library versions or production dependencies were introduced. Full
local control-plane checks and required exact-head hosted CI must finish before
merge; inspect their actual results rather than inferring completion here.

These tests do not render React in a real browser, interrupt an actual WebRTC
network path or approve/capture a Windows desktop. Updated actual browser
interruption, autoplay/gesture behavior and visual accessibility acceptance
remain required. Milestone 4 remains active; production media stays disabled.

## Viewer expiry follow-up

The browser previously compared only `Date.now()` with the grant expiry. A
backward system-clock change during viewing could defer its local cleanup until
the server closed signaling. Viewer setup now fixes the initially remaining
budget against `performance.now()` as well. The existing wall-clock comparison
still ends viewing on a forward jump; either deadline ends the same request.
Server and native lease enforcement are unchanged and remain authoritative.
This does not synchronize clocks, extend grants or guarantee browser timer
delivery while the browser is suspended.

Focused regressions cover an hour backward clock adjustment during a two-minute
session, a forward adjustment, an already-expired grant and a fresh request's
independent budget. Web tests and type checking passed locally. Full local and
exact-head hosted checks must pass before merging. Actual browser sleep/resume,
clock-change and automatic expiry acceptance remains unverified; no desktop
consent or capture is automated by these checks.

## Runtime preservation

Read-only Oracle verification passed: all seven protected/shared container image
IDs and start times matched the prior acceptance baseline, Remote/View production
health and readiness returned 200, production media remained disabled, and both
acceptance application containers stayed stopped. No production or shared
edge/relay deployment, local View process change, private identity replacement
or automation creation occurred.
