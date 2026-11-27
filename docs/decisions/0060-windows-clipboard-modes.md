# Windows clipboard sharing

Status: proposed for review, 26 November 2026. The owner approved clipboard writing in both directions on
19 November 2026, each direction gated by a local approval on the device. No code follows until this record is
accepted. It supersedes the clipboard sentences of [ADR 0021](0021-access-policy-and-session-lifecycle.md) for
Windows ("the viewer's clipboard reaches the computer only as typed input") and gives Windows the same three modes
Android already has in [ADR 0053](0053-device-clipboard-sharing.md).

## Today

- Windows never writes its clipboard for a viewer. Ctrl+V in the viewer types the text as keystrokes (at most 256
  UTF-16 units per message).
- Windows reads its clipboard whenever the controller presses "Copy from computer", with no local setting, at most once
  a second, up to 16,384 UTF-16 units.

## Decision

1. **Three modes, chosen on the computer.** The person at the Windows computer picks **Off**, **Button only** or
   **Automatic** in the host window (Access tab). The default is **Button only**. The server and the viewer cannot
   change it, and a change takes effect for the session in progress.
2. **Off** reads and writes nothing, and says so to the viewer. This is a change for reading: today a controller can
   read without a local setting.
3. **Button only** moves text only on a press: "Copy from computer" reads, "Send clipboard to computer" writes.
4. **Automatic** moves copied text both ways without a press while a viewer is connected, and stops when the session
   ends. It is never the default and is never switched on remotely.
5. **Writing needs a local approval.** The first write in a session is a session permission request, `clipboard`,
   decided on the computer through the sharing card like files, drive and print ([P0-4](../rdp-vnc-parity-roadmap.md)).
   Approval lasts for that connection only. Choosing Automatic in the host window counts as that approval for the
   connection. Revoke, Stop, Pause and the end of the session clear it.
6. **Reading** follows the mode and needs control, as today. It does not need a separate approval.
7. **Control is required** for either direction, because the clipboard rides on the controlled input channel; a
   view-only session has no clipboard.
8. **Text only**, plus the bounded HTML beside it that Android uses. At most 8,000 characters to the computer and
   16,384 UTF-16 units from it. Images and files stay out of scope ([ADR 0056](0056-image-clipboard-proposal.md)).
9. **Protected content stays put.** Automatic skips a clip whose source marks it as excluded from history or monitoring
   (the `ExcludeClipboardContentFromMonitorProcessing` and `CanIncludeInClipboardHistory` formats that password
   managers set). A button press still works, because a person chose it.
10. **Never on the sign-in screen.** The sign-in worker keeps clipboard disabled
    ([signin-authority.md](../signin-authority.md)); typing there is keystrokes only.

## Limits and handling

- A write is a single call to set the clipboard text, then the viewer is told it was written. Writes are limited to one
  per second and 30 per minute; more ends the clipboard channel, not the session.
- Contents are never logged, never stored on the server and never put in a file. Logs may say that a write or read
  happened, its size, and its outcome.
- A write replaces what is on the clipboard. The host window says "The viewer set your clipboard" with the time of the
  last write, so a person who did not expect it can see it happened.
- The announced mode goes only to a viewer that says hello first, so older viewers keep working.

## What to build, in order

1. Protocol: a `clipboard` session permission scope (TypeScript and Rust), a `clipboard_write` input, and the mode
   announcement. Unit tests for the permission gate and the limits.
2. Windows helper: write support beside `read_text`, with the mode enforced on both read and write.
3. Host window: the mode control and the "last write" line; the approval line in the sharing card.
4. Viewer: "Send clipboard to computer", the Automatic behaviour, and a clear unavailable state when the mode is Off.
5. Device checks on Surfiena: each mode, approval and denial, revoke, expiry, protected content, and the sign-in screen.

## Not decided here

Images, files and rich formats beyond bounded HTML; clipboard history; clipboard sync across more than one viewer
(there is one controller at a time).
