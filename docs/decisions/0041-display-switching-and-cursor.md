# 0041: Switching displays and the remote cursor

Status: accepted, 2026-10-14

## Context

A computer can have several displays. A session is approved for one display (ADR 0013, the consent window names it), and
the viewer may only choose a display the computer itself reported (migration 006). Switching to another display must not
widen what the person agreed to.

## Decision

- **Switching is a new, separately approved session.** The viewer's Display menu (shown when the computer reported more than
  one display) ends the current session and requests a new one on the chosen display. Under attended access the person at the
  computer is asked again, and the prompt names the new display. Under the owner's own trusted-access policy the new session
  follows that policy. Nothing carries an approval from one display to another, and a display that was never approved is
  never reachable by a helper who only asked for another.
- The list of displays comes from the computer's heartbeat, so a display that is plugged in, removed or changes resolution
  shows up in the menu within a heartbeat, and a request for one that has disappeared is refused by the server (unknown
  display) or by the computer (display unavailable).
- **The remote cursor is part of the picture.** The capture draws the system pointer into the frame, so its real shape, hiding
  and movement are exactly the computer's, with no separate overlay to fall out of step. The viewer's own pointer over the
  video is a small dot instead of an arrow, so there is never a second arrow on top.
- Coordinates stay in the display's physical pixels with its origin, as before, which covers scaling and displays left of or
  above the main one.

## Not done

Choosing several displays at once in the consent window ("allow all"), a live preview of each display in the menu, and
switching without the brief gap while the new session is set up. Rotation and hot-plug behaviour need a computer with
a second monitor to verify.
