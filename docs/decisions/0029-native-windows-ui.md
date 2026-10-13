# 0029 — Native Windows windows follow the approved design

Date: 2026-10-13

## Decision

The consent window, the active-sharing window and the host window are painted natively to match the approved
design: card layout, a status pill, an avatar and requester card, an access panel, radio cards, and
primary / secondary / danger buttons, using Segoe UI Variable. They follow the Windows light or dark setting
(including the title bar) and fall back to system colours in high-contrast mode. They are not web views: the
security-critical windows have no network content, no web runtime dependency and no script surface.

## How

`native_ui.rs` (shared by the helper and the host program) draws with GDI+ (anti-aliased shapes and icons) onto
a double buffer. Windows keep real child controls — static text, read-only identity fields, buttons — so Tab,
Enter, Escape, focus rings and screen readers keep working. Buttons, radio rows and the check box are owner-drawn
so they look right but remain real controls.

## Behaviour that came with it

- **Allow once / View only:** a control request can be approved as view only. The helper then offers no input
  channel and tells the viewer, which says control was not allowed.
- **Pause:** the active-sharing window can pause sharing. Pausing stops the screen and drops held input at once and
  tells the viewer why the picture stopped; resuming lets the already-approved viewer see the screen again. Pause
  never starts anything and Stop still ends the session.
- Decline is always the default answer. The deadline, cancellation and desktop-guard logic of the consent window
  are unchanged.
- The host window shows its state in a pill (stopped, starting, online, needs attention), is centred in the
  usable screen area, and carries the Beacon icon, which is also embedded in the executables.

## Not done

A tray flyout and the support-request flow from the design's tray preview are not built.
