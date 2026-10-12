//! Small shared presentation details for the native consent and Stop windows.
use std::io;
use windows_sys::Win32::Graphics::Gdi::{
    CreateFontW, DeleteObject, GetSysColor, GetSysColorBrush, SetBkColor, SetTextColor,
    COLOR_WINDOW, COLOR_WINDOWTEXT, DEFAULT_CHARSET, HFONT,
};

pub struct Font(pub HFONT);
impl Font {
    pub unsafe fn new(height: i32) -> Result<Self, io::Error> {
        let face: Vec<u16> = "Segoe UI".encode_utf16().chain(Some(0)).collect();
        let font = CreateFontW(
            -height,
            0,
            0,
            0,
            400,
            0,
            0,
            0,
            DEFAULT_CHARSET as u32,
            0,
            0,
            0,
            0,
            face.as_ptr(),
        );
        if font.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(font))
        }
    }
}
impl Drop for Font {
    fn drop(&mut self) {
        unsafe { DeleteObject(self.0) };
    }
}

// Use system colors, including high contrast, and a system-owned brush.
pub unsafe fn static_background(device_context: usize) -> isize {
    SetTextColor(device_context as _, GetSysColor(COLOR_WINDOWTEXT));
    SetBkColor(device_context as _, GetSysColor(COLOR_WINDOW));
    GetSysColorBrush(COLOR_WINDOW) as isize
}
