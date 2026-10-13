# 0033: Session recording by the helper

Status: accepted, 2026-10-13

## Context

Support work often needs a record of what was done. Media travels peer to peer (or through a relay that cannot
read it), so a server-side recording would mean decoding video on the server, which this product avoids. The
privacy rule is that nothing is recorded covertly.

## Decision

- **Recording happens in the helper's browser** (`MediaRecorder` on the incoming picture) and is saved as a file
  on the helper's own device when it stops. The server stores and sees nothing; retention and deletion are the
  helper's own files.
- **Permission is the computer's.** The consent window has a second box, "Also allow the helper to record this
  session", off by default. For the account's own trusted sessions the owner is the helper, so recording is
  allowed without a box. Remembered helpers and support codes need the box.
- **It is announced.** The viewer tells the computer when recording starts and stops on the same extras channel
  as files (`beacon-files-v1`, created when either permission was given); the sharing window shows
  "● Recording · the helper is recording this session" for as long as it lasts, and the viewer shows a red
  recording clock. A recording request when it was not allowed is answered `denied` and the viewer stops it.
- Ending the session, stopping sharing, or losing the channel ends the recording and the indicator.

## Honest limits

A helper's browser or operating system can always record their own screen without this feature; the
announcement covers the product's own recording, not a determined person with a phone camera. What the
product guarantees is that it never records without the computer having allowed it and being told.

## Not done

Server-side or encrypted-at-rest recordings, retention policies and in-app playback (the file is a normal
WebM/MP4 the helper plays or deletes themselves), and audio (the session has none).
