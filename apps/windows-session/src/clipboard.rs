//! The interactive user's clipboard text (ADR 0060). Text only and bounded. What a viewer may do is set by the person
//! at this computer in the host window (Off, Button only or Automatic), kept in `clipboard-mode.txt` beside the other
//! local settings and read afresh, so a change applies to the session in progress.
use std::time::{Duration, Instant};
use windows_sys::Win32::{
    Foundation::{GlobalFree, HGLOBAL},
    System::{
        DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
            IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
        },
        Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
    },
};

const CF_UNICODETEXT: u32 = 13;
/// UTF-16 units sent back at most; more is cut and reported as truncated.
pub const MAX_UNITS: usize = 16 * 1024;
/// Characters a viewer may write in one message.
pub const MAX_WRITE_CHARS: usize = 8_000;

pub struct ClipboardText {
    pub text: String,
    pub truncated: bool,
}

/// What the person at this computer allows (ADR 0060).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Nothing is read or written for a viewer.
    Off,
    /// Text moves only when the viewer presses a button. The default.
    Button,
    /// Copied text moves both ways while a viewer is connected.
    Auto,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Button => "button",
            Self::Auto => "auto",
        }
    }
}

/// The mode a settings file's text means. Anything missing or unknown is the safe default, Button only.
pub fn mode_from(text: Option<&str>) -> Mode {
    match text.map(|text| text.trim().to_ascii_lowercase()).as_deref() {
        Some("off") => Mode::Off,
        Some("auto") => Mode::Auto,
        _ => Mode::Button,
    }
}

fn settings_folder() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(std::path::PathBuf::from(base).join("BeaconRemote"))
}

/// The current mode, from the settings file; looked up at most twice a second.
pub fn mode() -> Mode {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<(Instant, Mode)>> = Mutex::new(None);
    let Ok(mut cache) = CACHE.lock() else {
        return Mode::Button;
    };
    if let Some((at, mode)) = *cache {
        if at.elapsed() < Duration::from_millis(500) {
            return mode;
        }
    }
    let text = settings_folder()
        .and_then(|folder| std::fs::read_to_string(folder.join("clipboard-mode.txt")).ok());
    let mode = mode_from(text.as_deref());
    *cache = Some((Instant::now(), mode));
    mode
}

/// Records that a viewer set the clipboard, for the host window to show (time only, never the text).
pub fn note_write() {
    let Some(folder) = settings_folder() else {
        return;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    let _ = std::fs::create_dir_all(&folder);
    let _ = std::fs::write(folder.join("clipboard-last-write.txt"), now.to_string());
}

/// Changes whenever the clipboard's content changes, whoever changed it.
pub fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

fn open() -> bool {
    for _ in 0..5 {
        if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

fn format(name: &str) -> u32 {
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { RegisterClipboardFormatW(wide.as_ptr()) }
}

/// Whether the program that set the clipboard marked it as not for monitoring or history, as password managers do.
/// Automatic sharing skips such text; a button press still works because a person chose it.
pub fn protected() -> bool {
    if !open() {
        return false;
    }
    let excluded = unsafe {
        let exclude = format("ExcludeClipboardContentFromMonitorProcessing");
        let history = format("CanIncludeInClipboardHistory");
        let mut excluded = IsClipboardFormatAvailable(exclude) != 0;
        if !excluded && IsClipboardFormatAvailable(history) != 0 {
            let handle = GetClipboardData(history);
            if !handle.is_null() {
                let global = handle as HGLOBAL;
                if GlobalSize(global) >= 4 {
                    let pointer = GlobalLock(global) as *const u32;
                    if !pointer.is_null() {
                        excluded = *pointer == 0;
                        GlobalUnlock(global);
                    }
                }
            }
        }
        excluded
    };
    unsafe {
        CloseClipboard();
    }
    excluded
}

pub fn read_text() -> Option<ClipboardText> {
    unsafe {
        // Another program may hold the clipboard for a moment; try briefly, never block.
        if !open() {
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

/// Replaces the clipboard with this text. The caller has already checked the mode, the approval and the length.
pub fn write_text(text: &str) -> bool {
    let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = units.len() * 2;
    unsafe {
        let global = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if global.is_null() {
            return false;
        }
        let pointer = GlobalLock(global) as *mut u16;
        if pointer.is_null() {
            GlobalFree(global);
            return false;
        }
        std::ptr::copy_nonoverlapping(units.as_ptr(), pointer, units.len());
        GlobalUnlock(global);
        if !open() {
            GlobalFree(global);
            return false;
        }
        EmptyClipboard();
        // On success the clipboard owns the memory; on failure it is still ours to free.
        let set = SetClipboardData(CF_UNICODETEXT, global as _);
        let ok = !set.is_null();
        if !ok {
            GlobalFree(global);
        }
        CloseClipboard();
        ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_or_missing_setting_is_button_only() {
        assert_eq!(mode_from(None), Mode::Button);
        assert_eq!(mode_from(Some("")), Mode::Button);
        assert_eq!(mode_from(Some("whatever")), Mode::Button);
        assert_eq!(mode_from(Some(" OFF \r\n")), Mode::Off);
        assert_eq!(mode_from(Some("Auto")), Mode::Auto);
        assert_eq!(mode_from(Some("button")), Mode::Button);
    }

    #[test]
    fn modes_have_stable_wire_names() {
        assert_eq!(Mode::Off.as_str(), "off");
        assert_eq!(Mode::Button.as_str(), "button");
        assert_eq!(Mode::Auto.as_str(), "auto");
    }
}
