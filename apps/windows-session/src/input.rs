//! User-session SendInput only. Never switches desktop, elevates, or uses UIAccess.
use beacon_remote_core::{ControlError, Display, Input, InputBackend, MouseButton};
use std::collections::BTreeSet;
use windows_sys::Win32::UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*};

pub struct WindowsInput {
    display: Display,
    keys: BTreeSet<(u16, bool)>,
    buttons: BTreeSet<MouseButton>,
    unicode: BTreeSet<u16>,
}
impl WindowsInput {
    pub fn new(display: Display) -> Self {
        Self {
            display,
            keys: BTreeSet::new(),
            buttons: BTreeSet::new(),
            unicode: BTreeSet::new(),
        }
    }
    fn send(input: INPUT) -> Result<(), ControlError> {
        if unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) } != 1 {
            return Err(ControlError::PlatformUnavailable);
        }
        Ok(())
    }
    fn mouse(dx: i32, dy: i32, data: u32, flags: u32) -> Result<(), ControlError> {
        Self::send(INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: data,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        })
    }
    fn key(scan: u16, extended: bool, down: bool) -> Result<(), ControlError> {
        Self::send(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: scan,
                    dwFlags: KEYEVENTF_SCANCODE
                        | if extended { KEYEVENTF_EXTENDEDKEY } else { 0 }
                        | if down { 0 } else { KEYEVENTF_KEYUP },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        })
    }
    fn button(button: MouseButton, down: bool) -> Result<(), ControlError> {
        let flags = match (button, down) {
            (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
            (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
            (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
            (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
            (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
            (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
        };
        Self::mouse(0, 0, 0, flags)
    }
    fn unicode(scan: u16, down: bool) -> Result<(), ControlError> {
        Self::send(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: 0,
                    wScan: scan,
                    dwFlags: KEYEVENTF_UNICODE | if down { 0 } else { KEYEVENTF_KEYUP },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        })
    }
}
impl InputBackend for WindowsInput {
    fn inject(&mut self, input: &Input) -> Result<(), ControlError> {
        if !crate::capture::desktop_receives_input() {
            return Err(ControlError::PlatformUnavailable);
        }
        input.validate()?;
        // A changed display layout ends control; don't inject using stale geometry.
        let current =
            crate::capture::primary_display().map_err(|_| ControlError::PlatformUnavailable)?;
        if current.id != self.display.id
            || current.width != self.display.width
            || current.height != self.display.height
            || current.origin_x != self.display.origin_x
            || current.origin_y != self.display.origin_y
        {
            return Err(ControlError::PlatformUnavailable);
        }
        match input {
            Input::MovePointer { display_id, x, y } => {
                if display_id != &self.display.id
                    || *x >= self.display.width
                    || *y >= self.display.height
                {
                    return Err(ControlError::InvalidInput);
                }
                let (left, top, width, height) = unsafe {
                    (
                        GetSystemMetrics(SM_XVIRTUALSCREEN),
                        GetSystemMetrics(SM_YVIRTUALSCREEN),
                        GetSystemMetrics(SM_CXVIRTUALSCREEN),
                        GetSystemMetrics(SM_CYVIRTUALSCREEN),
                    )
                };
                let px = i64::from(self.display.origin_x) + i64::from(*x) - i64::from(left);
                let py = i64::from(self.display.origin_y) + i64::from(*y) - i64::from(top);
                if width <= 1
                    || height <= 1
                    || px < 0
                    || py < 0
                    || px >= i64::from(width)
                    || py >= i64::from(height)
                {
                    return Err(ControlError::InvalidInput);
                }
                Self::mouse(
                    (px * 65535 / i64::from(width - 1)) as i32,
                    (py * 65535 / i64::from(height - 1)) as i32,
                    0,
                    MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                )
            }
            Input::Button { button, down } => {
                if !down && !self.buttons.contains(button) {
                    return Ok(());
                }
                // Track before sending so a partially failed operation still gets cleanup.
                if *down {
                    self.buttons.insert(*button);
                }
                Self::button(*button, *down)?;
                if !down {
                    self.buttons.remove(button);
                }
                Ok(())
            }
            Input::Key {
                scan_code,
                extended,
                down,
            } => {
                let key = (*scan_code, *extended);
                if !down && !self.keys.contains(&key) {
                    return Ok(());
                }
                if *down {
                    self.keys.insert(key);
                }
                Self::key(*scan_code, *extended, *down)?;
                if !down {
                    self.keys.remove(&key);
                }
                Ok(())
            }
            Input::Scroll {
                horizontal,
                vertical,
            } => {
                if *vertical != 0 {
                    Self::mouse(0, 0, *vertical as u32, MOUSEEVENTF_WHEEL)?;
                }
                if *horizontal != 0 {
                    Self::mouse(0, 0, *horizontal as u32, MOUSEEVENTF_HWHEEL)?;
                }
                Ok(())
            }
            Input::TypeText { text } => {
                for scan in text.encode_utf16() {
                    self.unicode.insert(scan);
                    Self::unicode(scan, true)?;
                    Self::unicode(scan, false)?;
                    self.unicode.remove(&scan);
                }
                Ok(())
            }
            Input::KeepAlive => Ok(()),
            Input::ReleaseAll => {
                self.release_all();
                if self.keys.is_empty() && self.buttons.is_empty() && self.unicode.is_empty() {
                    Ok(())
                } else {
                    Err(ControlError::PlatformUnavailable)
                }
            }
        }
    }
    fn release_all(&mut self) {
        // SendInput itself respects UIPI. Never switch into a locked/UAC desktop.
        self.keys
            .retain(|(scan, extended)| Self::key(*scan, *extended, false).is_err());
        self.buttons
            .retain(|button| Self::button(*button, false).is_err());
        self.unicode
            .retain(|scan| Self::unicode(*scan, false).is_err());
    }
}
impl Drop for WindowsInput {
    fn drop(&mut self) {
        self.release_all();
        // Keep only cleanup ownership after authority ends. UIPI may transiently
        // block key-up while an elevated foreground window is active. Retry on
        // our ordinary input desktop; never switch desktop/elevate or send downs.
        let until = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while (!self.keys.is_empty() || !self.buttons.is_empty() || !self.unicode.is_empty())
            && std::time::Instant::now() < until
        {
            std::thread::sleep(std::time::Duration::from_millis(25));
            if crate::capture::desktop_receives_input() {
                self.release_all();
            }
        }
        if !self.keys.is_empty() || !self.buttons.is_empty() || !self.unicode.is_empty() {
            eprintln!("Input cleanup could not complete within the ordinary-desktop retry budget. Control remains ended; local keyboard/mouse state must be checked.");
        }
    }
}
