# 0031: File transfer to the computer

Status: accepted, 2026-10-13

## Context

Sending a tool or an installer to the computer being helped is the most common support task after seeing the
screen. It is also a new way to put content on someone's computer, so it follows the same rule as control: only
what the person at the computer chooses, visibly, and revocable at once.

## Decision

- **Permission.** The consent window has a separate "Also allow receiving files" box, off by default, for both
  view-only and control approvals. Nothing server-side grants it and no policy can raise it: the helper process
  opens the file channel only if that box was ticked for this session. The sharing window then shows
  "File transfer allowed · saved in Downloads\Beacon Remote" and announces each file as it arrives.
- **Trusted sessions.** With no consent window, the computer's own setting decides: the host window has
  "Also let my account send files to this computer", available only while trusted access is on. It is stored
  locally next to the access setting and never sent to the server; the agent tells the helper
  (`localFiles`) only for the account's own sessions, never for support codes or remembered helpers. Turning it
  off, or lowering trusted access, applies from the next session.
- **Sending to the helper.** The sharing window has "Send a file…" while file transfer is allowed. The person
  at the computer picks the file in the standard Windows dialog; the helper's browser is offered it (`send`,
  even ids) and nothing flows until the helper chooses Save. It is held in memory (up to 512 MB), checked against
  the computer's SHA-256 and only then handed to the browser to save; a mismatch is discarded and reported.
- **Channel.** A second ordered, reliable data channel, `beacon-files-v1`, created by the computer next to the
  video track (and the input channel when control was allowed). Text messages are JSON control messages
  (`offer`, `end`, `cancel` from the viewer; `ready`, `accept`, `reject`, `done`, `failed`, `paused` from the
  computer); binary messages are a 4-byte id then up to 64 KiB of the file. Unknown fields and oversized
  messages end the channel.
- **Where and how files land.** One folder, `Downloads\Beacon Remote`. The proposed name is reduced to one safe
  path component (no separators, reserved characters or device names), never overwrites (`name (1).ext`), is
  written to a `.beaconpart` file and renamed only after the length and the viewer's SHA-256 match. The finished
  file gets the Mark of the Web (`Zone.Identifier`, zone 3) so SmartScreen and Office treat it as downloaded.
  An unfinished or failed file is deleted.
- **Limits.** One file at a time; 2 GiB per file, 4 GiB per session; a viewer that goes quiet for 30 s is
  dropped. Pause rejects offers and aborts a file in flight; Stop or any loss of session authority closes the
  channel and removes partial files.

## Not done

Resume of an interrupted transfer, files larger than 512 MB towards the browser (needs streaming to disk), and revoking the trusted-session setting from the web (it is local only). The web side only offers
Send file when the computer opened the channel.
