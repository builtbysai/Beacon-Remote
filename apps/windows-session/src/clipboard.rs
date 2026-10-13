//! Reads the interactive user's clipboard text when the controller asks (ADR 0021). Text only,
//! bounded, and never written: the viewer's clipboard reaches the computer only as typed input.
use windows_sys::Win32::{
    Foundation::HGLOBAL,
    System::{
        DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
        Memory::{GlobalLock, GlobalSize, GlobalUnlock},
    },
};

const CF_UNICODETEXT: u32 = 13;
/// UTF-16 units sent back at most; more is cut and reported as truncated.
pub const MAX_UNITS: usize = 16 * 1024;

pub struct ClipboardText {
    pub text: String,
    pub truncated: bool,
}

pub fn read_text() -> Option<ClipboardText> {
    unsafe {
        // Another program may hold the clipboard for a moment; try briefly, never block.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !opened {
            return None;
        }
        let handle = GetClipboardData(CF_UNICODETEXT);
        let result = if handle.is_null() {
            None
        } else {
            let global = handle as HGLOBAL;
            let size = GlobalSize(global) / 2;
            let pointer = GlobalLock(global) as *const u16;
            if pointer.is_null() {
                None
            } else {
                let mut units = std::slice::from_raw_parts(pointer, size).to_vec();
                GlobalUnlock(global);
                if let Some(end) = units.iter().position(|&unit| unit == 0) {
                    units.truncate(end);
                }
                let truncated = units.len() > MAX_UNITS;
                units.truncate(MAX_UNITS);
                // A cut inside a surrogate pair becomes a replacement character, never invalid text.
                Some(ClipboardText {
                    text: String::from_utf16_lossy(&units),
                    truncated,
                })
            }
        };
        CloseClipboard();
        result
    }
}
