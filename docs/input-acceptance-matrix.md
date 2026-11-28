# Input fidelity acceptance matrix (R24)

What "feels local" must mean before input is called accepted. Each row is checked on a real computer or phone with a
harmless application (Notepad, a text field, a file list), comparing the typed or clicked result with the intended one.
Record the date, viewer browser and device, host build and result. Compilation, unit tests and synthetic fixtures are
supporting evidence only.

| Area           | Check                                                                                     | Windows host | Android host | Sign-in screen |
| -------------- | ----------------------------------------------------------------------------------------- | ------------ | ------------ | -------------- |
| Typing         | A paragraph with capitals, digits, punctuation and Enter arrives exactly                  | ☐            | ☐            | ☐ (password)   |
| Layouts        | AltGr characters (e.g. €), a dead key (é), and an IME composition                         | ☐            | ☐            | n/a            |
| Shortcuts      | Ctrl+C / Ctrl+V / Ctrl+Z, Alt+Tab (or the viewer's substitute), Windows key               | ☐            | n/a          | n/a            |
| Escape         | Plain Escape closes a remote menu; Shift+Escape gives the keyboard back here              | ☐            | ☐            | ☐              |
| Pointer        | Click, double click, right click land on the intended target at 100 %, 150 %, 200 % scale | ☐            | ☐            | ☐              |
| Drag           | Select text by dragging; drag a file icon; drag a window                                  | ☐            | ☐            | n/a            |
| Scroll         | Wheel and trackpad scroll by the expected amount, both directions                         | ☐            | ☐            | n/a            |
| Touch          | Trackpad and direct modes, long press, two-finger scroll on a phone viewer                | ☐            | ☐            | ☐              |
| Rotation / DPI | Pointer mapping stays correct after rotating a phone host and moving between monitors     | ☐            | ☐            | n/a            |
| Stuck input    | After blur, Pause, Stop, network loss and lease expiry, no key or button stays down       | ☐            | ☐            | ☐              |
| Handoff        | After signing in through the sign-in view, nothing is held on the desktop that follows    | ☐            | n/a          | ☐              |
| Responsiveness | Measured action-to-visible-result for a key and a click (not FPS, not network round trip) | ☐            | ☐            | ☐              |

Known product rules this matrix checks against: on the sign-in screen every non-modifier key is a complete tap and
modifiers are pressed only around a key (so nothing is held when Windows switches desktops); Ctrl+Alt+Del has its own
action; Shift+Escape releases input in every viewer.
