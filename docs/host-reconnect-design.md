# Host reconnect after a short network loss (design, not built)

Status: proposal, 19 November 2026. It needs the owner's approval before code, because it changes
who can re-attach to a live session.

## Evidence

An 8 s Wi-Fi drop on the Pixel (isolated acceptance backend, `a35029e`) ended a live unattended
control session. The phone log shows the signaling socket failing and then `Session ended: Connection
lost`. The backend closes the session as soon as the phone's socket closes. The browser viewer
already survives its own drops (`sessions/{id}/resume`, 120 s attended, 300 s trusted), but nothing lets the
host do the same.

## Goal

A drop of up to 20 s on the host's network does not end the session. Capture and input stay
stopped during the drop. When the host is back the viewer sees video again with no click. A longer drop,
Stop, local revoke, accessibility loss, lock, expiry and a second host all still end the session.

## Proposed changes

Backend (`apps/backend/src/sessions.ts`):

- When the host socket closes on a session that is active and resumable, do not call `finish`. Mark the
  entry `machineDetachedUntil = now + 20 s` and tell the viewer `host-lost` so it shows "Reconnecting".
- Allow exactly one re-attach of the machine role while detached, authenticated by the same bearer
  as the first join (the session's `token_hash`) and the same host instance id. Any other role,
  bearer or instance is refused as today.
- On re-attach send the host a new `joined` with `generation + 1` and send the viewer `host-resumed`.
  Offers, answers and ICE restart under the new generation; the old peer is discarded.
- At the deadline, or on Stop, expiry, revoke or policy change, finish as today. Do not extend the
  session deadline.

Android (`ShareSession.kt`):

- On signaling failure, stop capture and release input at once, keep the foreground notification
  with the text "Reconnecting", and retry the signaling socket every 2 s for 20 s with the same bearer.
- After re-attach, re-check local conditions (unattended still on, device unlocked, accessibility
  on) before sending `consent` again. Any failed check ends the session.
- The lease restarts from zero after the re-attach, so capture waits for a fresh server reply.

Viewer (`apps/web/src/LiveView.tsx`): show "Host reconnecting" on `host-lost`, then rebuild the
peer on `host-resumed`. Reuse the existing reconnect code.

## Security notes

- Detaching does not lengthen any authorization. The 3 s lease, the session deadline and policy
  checks are unchanged. Nothing is captured or injected while the host is detached.
- The re-attach credential is the same one that started the session and is single use per generation;
  a replayed old generation is refused.
- Attended sessions: the host re-sends consent state but the person's original approval is not renewed.
  A drop longer than 20 s needs a new request and approval. (Option: skip resume for attended sessions
  in the first release.)

## Tests

- Backend: unit tests for the detach window and the re-attach checks (wrong bearer, wrong instance,
  late, twice).
- Device: Pixel, Wi-Fi off for 8 s and 15 s resumes without a tap; 25 s ends; Stop during the drop ends;
  lock during the drop ends on re-attach; accessibility removed during the drop ends.

## Questions for the owner

1. Is a 20 s host window acceptable, or should trusted sessions get more (the viewer window is 300 s)?
2. Should attended sessions resume, or only unattended ones?
