# Device clipboard sharing

ADR 0021 left the clipboard out of the session model: the viewer's Ctrl+V types text on the computer, and the
computer's clipboard is only read when a viewer presses a button. This record sets how a phone shares its clipboard in
both directions, and who decides.

## Decision

- The person who owns the device chooses, on the device, one of three modes: **Off**, **Button only** (the default) or
  **Automatic**. The server and the viewer cannot change it.
- Off: the device never reads or writes its clipboard for a viewer, and tells the viewer so.
- Button only: text moves only when the viewer presses "Copy from phone" or "Send clipboard to phone".
- Automatic: while a viewer is connected, copied text moves both ways without a press. It stops when the session ends.
- Text, plus formatted (HTML) text of at most 6,000 characters carried beside it, for now, at most 8,000 characters to the device and 32,768 from it. Images and files
  are not shared and need their own record.
- The device announces its mode only to a viewer that says hello first, so older viewers and hosts keep working.
- Unattended and attended sessions follow the same setting. Visible sharing, Stop and Pause are unchanged.

## Why

A clipboard can hold a password or a private message. A default that moves nothing until someone presses a button keeps
the old guarantee for people who do not choose anything, while Automatic gives a trusted personal device the
"copy here, paste there" behavior people expect.

## Checks

Pixel, 19 Nov 2026: Button only round-tripped text; Automatic wrote the viewer's text to the phone with no press;
Off disabled the send button and wrote nothing. Windows follows ADR 0021 until it has the same setting.
