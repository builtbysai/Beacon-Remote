//! Drawing for Beacon Remote's native windows, matching the approved design (ADR 0029).
//!
//! Windows keep real child controls (static text, buttons) so keyboard navigation and screen readers
//! work; this module paints what sits behind and on them: cards, pills, the avatar, icons and the
//! owner-drawn buttons. It follows the Windows light/dark setting and uses system colors in
//! high-contrast mode. Included by both the session helper and the host program.
#![allow(dead_code)]
use std::{ptr::null_mut, sync::OnceLock};
use windows_sys::Win32::{
    Graphics::{
        Dwm::DwmSetWindowAttribute,
        Gdi::{
            CreateFontW, DeleteObject, GetSysColor, COLOR_BTNFACE, COLOR_BTNTEXT, COLOR_GRAYTEXT,
            COLOR_HIGHLIGHT, COLOR_HIGHLIGHTTEXT, COLOR_WINDOW, COLOR_WINDOWTEXT, DEFAULT_CHARSET,
            HDC, HFONT,
        },
        GdiPlus::*,
    },
    System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
    UI::{
        Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW},
        WindowsAndMessaging::{SystemParametersInfoW, SPI_GETHIGHCONTRAST},
    },
};

pub type Color = u32;
const fn rgb(value: u32) -> Color {
    0xFF00_0000 | value
}
fn sys(index: i32) -> Color {
    let value = unsafe { GetSysColor(index) };
    rgb(((value & 0xff) << 16) | (value & 0xff00) | ((value >> 16) & 0xff))
}

/// The design's tokens (DESIGN_SPEC / product.css) for each appearance.
#[derive(Clone, Copy)]
pub struct Palette {
    pub window: Color,
    pub surface: Color,
    pub subtle: Color,
    pub line: Color,
    pub strong: Color,
    pub text: Color,
    pub muted: Color,
    pub faint: Color,
    pub accent: Color,
    pub accent_hover: Color,
    pub accent_soft: Color,
    pub on_accent: Color,
    pub success: Color,
    pub success_soft: Color,
    pub danger: Color,
    pub danger_soft: Color,
    pub warn: Color,
    pub warn_soft: Color,
    pub warn_line: Color,
    pub bar: Color,
    pub contrast: bool,
}

pub fn palette() -> Palette {
    if high_contrast() {
        return Palette {
            window: sys(COLOR_WINDOW),
            surface: sys(COLOR_WINDOW),
            subtle: sys(COLOR_WINDOW),
            line: sys(COLOR_WINDOWTEXT),
            strong: sys(COLOR_WINDOWTEXT),
            text: sys(COLOR_WINDOWTEXT),
            muted: sys(COLOR_WINDOWTEXT),
            faint: sys(COLOR_GRAYTEXT),
            accent: sys(COLOR_HIGHLIGHT),
            accent_hover: sys(COLOR_HIGHLIGHT),
            accent_soft: sys(COLOR_WINDOW),
            on_accent: sys(COLOR_HIGHLIGHTTEXT),
            success: sys(COLOR_WINDOWTEXT),
            success_soft: sys(COLOR_WINDOW),
            danger: sys(COLOR_BTNTEXT),
            danger_soft: sys(COLOR_BTNFACE),
            warn: sys(COLOR_WINDOWTEXT),
            warn_soft: sys(COLOR_WINDOW),
            warn_line: sys(COLOR_WINDOWTEXT),
            bar: sys(COLOR_WINDOW),
            contrast: true,
        };
    }
    if dark_mode() {
        Palette {
            window: rgb(0x1c232d),
            surface: rgb(0x1c232d),
            subtle: rgb(0x202833),
            line: rgb(0x354151),
            strong: rgb(0xf1f5fb),
            text: rgb(0xdce5f1),
            muted: rgb(0xa2b0c2),
            faint: rgb(0x8796a7),
            accent: rgb(0x2357c9),
            accent_hover: rgb(0x2c67d4),
            accent_soft: rgb(0x233750),
            on_accent: rgb(0xffffff),
            success: rgb(0x48d6a2),
            success_soft: rgb(0x16352e),
            danger: rgb(0xf38f83),
            danger_soft: rgb(0x3a2422),
            warn: rgb(0xe9c46a),
            warn_soft: rgb(0x3a3220),
            warn_line: rgb(0x5a4c2a),
            bar: rgb(0x0f1a2b),
            contrast: false,
        }
    } else {
        Palette {
            window: rgb(0xffffff),
            surface: rgb(0xffffff),
            subtle: rgb(0xf9fafb),
            line: rgb(0xe3e7eb),
            strong: rgb(0x142238),
            text: rgb(0x273448),
            muted: rgb(0x687686),
            faint: rgb(0x8a95a3),
            accent: rgb(0x1f50b5),
            accent_hover: rgb(0x123f98),
            accent_soft: rgb(0xeaf1ff),
            on_accent: rgb(0xffffff),
            success: rgb(0x007e58),
            success_soft: rgb(0xe6f5ef),
            danger: rgb(0xb84d46),
            danger_soft: rgb(0xfdecea),
            warn: rgb(0x7a5a10),
            warn_soft: rgb(0xfdf3dc),
            warn_line: rgb(0xecd9a4),
            bar: rgb(0x142238),
            contrast: false,
        }
    }
}

pub fn dark_mode() -> bool {
    unsafe {
        let mut value = 1u32;
        let mut size = 4u32;
        let name: Vec<u16> = "AppsUseLightTheme".encode_utf16().chain(Some(0)).collect();
        let key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            std::ptr::addr_of_mut!(value).cast(),
            &mut size,
        ) == 0
            && value == 0
    }
}

pub fn high_contrast() -> bool {
    unsafe {
        let mut info: HIGHCONTRASTW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<HIGHCONTRASTW>() as u32;
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            info.cbSize,
            std::ptr::addr_of_mut!(info).cast(),
            0,
        ) != 0
            && info.dwFlags & HCF_HIGHCONTRASTON != 0
    }
}

/// Makes the window's title bar follow the Windows appearance.
pub unsafe fn style_title_bar(window: isize, dark: bool) {
    let enabled = i32::from(dark);
    DwmSetWindowAttribute(window as _, 20, std::ptr::addr_of!(enabled).cast(), 4);
}

pub fn colorref(color: Color) -> u32 {
    ((color >> 16) & 0xff) | (color & 0xff00) | ((color & 0xff) << 16)
}

fn ensure_gdiplus() {
    static TOKEN: OnceLock<usize> = OnceLock::new();
    TOKEN.get_or_init(|| unsafe {
        let input = GdiplusStartupInput {
            GdiplusVersion: 1,
            DebugEventCallback: 0,
            SuppressBackgroundThread: 0,
            SuppressExternalCodecs: 1,
        };
        let mut token = 0usize;
        GdiplusStartup(&mut token, &input, null_mut());
        token
    });
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// "Segoe UI Variable" where Windows has it, "Segoe UI" elsewhere.
pub fn face() -> &'static str {
    static FACE: OnceLock<&'static str> = OnceLock::new();
    FACE.get_or_init(|| {
        ensure_gdiplus();
        unsafe {
            let mut family: *mut GpFontFamily = null_mut();
            let status = GdipCreateFontFamilyFromName(
                wide("Segoe UI Variable Text").as_ptr(),
                null_mut(),
                &mut family,
            );
            if status == 0 {
                GdipDeleteFontFamily(family);
                "Segoe UI Variable Text"
            } else {
                "Segoe UI"
            }
        }
    })
}

/// A GDI font for child controls: `height` is in device pixels, `weight` 400/600/700.
pub unsafe fn gdi_font(height: i32, weight: i32) -> HFONT {
    CreateFontW(
        -height,
        0,
        0,
        0,
        weight,
        0,
        0,
        0,
        DEFAULT_CHARSET as u32,
        0,
        0,
        5,
        0,
        wide(face()).as_ptr(),
    )
}
pub unsafe fn delete_font(font: HFONT) {
    if !font.is_null() {
        DeleteObject(font);
    }
}

/// A shared flat-colour brush for read-only edit controls; one per colour, kept for the process.
pub unsafe fn surface_brush(color: Color) -> windows_sys::Win32::Graphics::Gdi::HBRUSH {
    use std::{collections::HashMap, sync::Mutex};
    use windows_sys::Win32::Graphics::Gdi::CreateSolidBrush;
    static BRUSHES: OnceLock<Mutex<HashMap<u32, usize>>> = OnceLock::new();
    let mut brushes = BRUSHES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap();
    *brushes
        .entry(color)
        .or_insert_with(|| CreateSolidBrush(colorref(color)) as usize) as _
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
}

/// Anti-aliased drawing in device-independent pixels; `scale` converts to device pixels.
pub struct Canvas {
    graphics: *mut GpGraphics,
    pub scale: f32,
}
impl Canvas {
    pub unsafe fn new(hdc: HDC, scale: f32) -> Option<Self> {
        ensure_gdiplus();
        let mut graphics: *mut GpGraphics = null_mut();
        if GdipCreateFromHDC(hdc, &mut graphics) != 0 || graphics.is_null() {
            return None;
        }
        GdipSetSmoothingMode(graphics, SmoothingModeAntiAlias);
        GdipSetTextRenderingHint(graphics, TextRenderingHintClearTypeGridFit);
        GdipSetPixelOffsetMode(graphics, PixelOffsetModeHalf);
        Some(Self { graphics, scale })
    }
    fn s(&self, value: f32) -> f32 {
        value * self.scale
    }
    unsafe fn path(&self, x: f32, y: f32, w: f32, h: f32, radius: f32) -> *mut GpPath {
        let mut path: *mut GpPath = null_mut();
        GdipCreatePath(FillModeAlternate, &mut path);
        let (x, y, w, h) = (self.s(x), self.s(y), self.s(w), self.s(h));
        let d = (self.s(radius) * 2.0).min(w).min(h);
        if d <= 0.5 {
            GdipAddPathRectangle(path, x, y, w, h);
        } else {
            GdipAddPathArc(path, x, y, d, d, 180.0, 90.0);
            GdipAddPathArc(path, x + w - d, y, d, d, 270.0, 90.0);
            GdipAddPathArc(path, x + w - d, y + h - d, d, d, 0.0, 90.0);
            GdipAddPathArc(path, x, y + h - d, d, d, 90.0, 90.0);
        }
        GdipClosePathFigure(path);
        path
    }
    pub unsafe fn fill(&self, x: f32, y: f32, w: f32, h: f32, radius: f32, color: Color) {
        let path = self.path(x, y, w, h, radius);
        let mut brush: *mut GpSolidFill = null_mut();
        GdipCreateSolidFill(color, &mut brush);
        GdipFillPath(self.graphics, brush.cast(), path);
        GdipDeleteBrush(brush.cast());
        GdipDeletePath(path);
    }
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn stroke(
        &self,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
        color: Color,
        width: f32,
    ) {
        // Inset by half the pen so the line stays inside the rectangle.
        let half = width / 2.0;
        let path = self.path(
            x + half,
            y + half,
            w - width,
            h - width,
            (radius - half).max(0.0),
        );
        let mut pen: *mut GpPen = null_mut();
        GdipCreatePen1(color, self.s(width), UnitPixel, &mut pen);
        GdipDrawPath(self.graphics, pen, path);
        GdipDeletePen(pen);
        GdipDeletePath(path);
    }
    pub unsafe fn circle(&self, cx: f32, cy: f32, r: f32, color: Color) {
        let mut brush: *mut GpSolidFill = null_mut();
        GdipCreateSolidFill(color, &mut brush);
        GdipFillEllipse(
            self.graphics,
            brush.cast(),
            self.s(cx - r),
            self.s(cy - r),
            self.s(r * 2.0),
            self.s(r * 2.0),
        );
        GdipDeleteBrush(brush.cast());
    }
    pub unsafe fn ring(&self, cx: f32, cy: f32, r: f32, color: Color, width: f32) {
        let mut pen: *mut GpPen = null_mut();
        GdipCreatePen1(color, self.s(width), UnitPixel, &mut pen);
        GdipDrawEllipse(
            self.graphics,
            pen,
            self.s(cx - r + width / 2.0),
            self.s(cy - r + width / 2.0),
            self.s(r * 2.0 - width),
            self.s(r * 2.0 - width),
        );
        GdipDeletePen(pen);
    }
    pub unsafe fn line(&self, x1: f32, y1: f32, x2: f32, y2: f32, color: Color, width: f32) {
        let mut pen: *mut GpPen = null_mut();
        GdipCreatePen1(color, self.s(width), UnitPixel, &mut pen);
        GdipSetPenStartCap(pen, LineCapRound);
        GdipSetPenEndCap(pen, LineCapRound);
        GdipDrawLine(
            self.graphics,
            pen,
            self.s(x1),
            self.s(y1),
            self.s(x2),
            self.s(y2),
        );
        GdipDeletePen(pen);
    }
    /// Draws text inside a box. `size` is in DIPs; `weight` is 400, 600 or 700.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn text(
        &self,
        text: &str,
        (x, y, w, h): (f32, f32, f32, f32),
        size: f32,
        weight: i32,
        color: Color,
        align: Align,
        center_vertically: bool,
    ) {
        let family_name = if weight >= 600 && face() == "Segoe UI Variable Text" {
            "Segoe UI Variable Display"
        } else if weight >= 600 {
            "Segoe UI Semibold"
        } else {
            face()
        };
        let mut family: *mut GpFontFamily = null_mut();
        if GdipCreateFontFamilyFromName(wide(family_name).as_ptr(), null_mut(), &mut family) != 0 {
            GdipCreateFontFamilyFromName(wide("Segoe UI").as_ptr(), null_mut(), &mut family);
        }
        let style = i32::from(weight >= 700);
        let mut font: *mut GpFont = null_mut();
        GdipCreateFont(family, self.s(size), style, UnitPixel, &mut font);
        let mut format: *mut GpStringFormat = null_mut();
        GdipCreateStringFormat(0, 0, &mut format);
        GdipSetStringFormatAlign(
            format,
            match align {
                Align::Left => StringAlignmentNear,
                Align::Center => StringAlignmentCenter,
                Align::Right => StringAlignmentFar,
            },
        );
        GdipSetStringFormatLineAlign(
            format,
            if center_vertically {
                StringAlignmentCenter
            } else {
                StringAlignmentNear
            },
        );
        GdipSetStringFormatTrimming(format, StringTrimmingEllipsisCharacter);
        let mut brush: *mut GpSolidFill = null_mut();
        GdipCreateSolidFill(color, &mut brush);
        let rect = RectF {
            X: self.s(x),
            Y: self.s(y),
            Width: self.s(w),
            Height: self.s(h),
        };
        let wide_text = wide(text);
        GdipDrawString(
            self.graphics,
            wide_text.as_ptr(),
            -1,
            font,
            &rect,
            format,
            brush.cast(),
        );
        GdipDeleteBrush(brush.cast());
        GdipDeleteStringFormat(format);
        GdipDeleteFont(font);
        GdipDeleteFontFamily(family);
    }
}
impl Drop for Canvas {
    fn drop(&mut self) {
        unsafe {
            GdipDeleteGraphics(self.graphics);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Primary,
    Secondary,
    Danger,
}

#[derive(Clone, Copy, Default)]
pub struct State {
    pub hot: bool,
    pub pressed: bool,
    pub focused: bool,
    pub disabled: bool,
}

/// A design button: filled accent (primary), outlined (secondary) or red (danger).
pub unsafe fn button(
    canvas: &Canvas,
    p: &Palette,
    (w, h): (f32, f32),
    label: &str,
    role: Role,
    state: State,
) {
    let (fill, border, ink) = match role {
        Role::Primary => (
            if state.hot || state.pressed {
                p.accent_hover
            } else {
                p.accent
            },
            if state.hot || state.pressed {
                p.accent_hover
            } else {
                p.accent
            },
            p.on_accent,
        ),
        Role::Secondary => (
            if state.hot || state.pressed {
                p.subtle
            } else {
                p.surface
            },
            p.line,
            p.strong,
        ),
        Role::Danger => (
            if state.hot || state.pressed {
                p.danger
            } else {
                p.danger_soft
            },
            p.danger,
            if state.hot || state.pressed {
                p.on_accent
            } else {
                p.danger
            },
        ),
    };
    let ink = if state.disabled { p.faint } else { ink };
    canvas.fill(0.0, 0.0, w, h, 8.0, fill);
    canvas.stroke(0.0, 0.0, w, h, 8.0, border, 1.0);
    canvas.text(label, (0.0, 0.0, w, h), 13.5, 600, ink, Align::Center, true);
    if state.focused {
        // Inside the button so the ring is never clipped; on the filled button a light inner line
        // keeps it visible against the fill.
        let ring = if role == Role::Primary {
            p.strong
        } else {
            p.accent
        };
        canvas.stroke(0.0, 0.0, w, h, 8.0, ring, 2.5);
        if role == Role::Primary {
            canvas.stroke(2.5, 2.5, w - 5.0, h - 5.0, 6.0, p.on_accent, 1.5);
        }
    }
}

/// A radio card: title and one line of help, selected state with the accent outline.
pub unsafe fn radio_card(
    canvas: &Canvas,
    p: &Palette,
    (w, h): (f32, f32),
    title: &str,
    help: &str,
    selected: bool,
    state: State,
) {
    let fill = if selected { p.accent_soft } else { p.surface };
    let border = if selected { p.accent } else { p.line };
    canvas.fill(0.0, 0.0, w, h, 10.0, fill);
    canvas.stroke(
        0.0,
        0.0,
        w,
        h,
        10.0,
        border,
        if selected { 2.0 } else { 1.0 },
    );
    let ink = if state.disabled { p.faint } else { p.strong };
    let sub = if state.disabled { p.faint } else { p.muted };
    // The radio dot.
    canvas.ring(
        22.0,
        24.0,
        8.0,
        if selected { p.accent } else { p.faint },
        1.5,
    );
    if selected {
        canvas.circle(22.0, 24.0, 4.0, p.accent);
    }
    canvas.text(
        title,
        (40.0, 13.0, w - 48.0, 20.0),
        13.5,
        600,
        ink,
        Align::Left,
        false,
    );
    canvas.text(
        help,
        (40.0, 34.0, w - 48.0, 20.0),
        12.0,
        400,
        sub,
        Align::Left,
        false,
    );
    if state.focused {
        canvas.stroke(0.0, 0.0, w, h, 10.0, p.accent, 2.5);
    }
}

/// A labelled check box: a small rounded square, a tick when checked, then the text.
pub unsafe fn checkbox(
    canvas: &Canvas,
    p: &Palette,
    (w, h): (f32, f32),
    label: &str,
    checked: bool,
    state: State,
) {
    let top = (h - 18.0) / 2.0;
    if checked {
        canvas.fill(1.0, top, 18.0, 18.0, 4.0, p.accent);
        canvas.line(5.0, top + 9.5, 8.5, top + 13.0, p.window, 2.0);
        canvas.line(8.5, top + 13.0, 15.0, top + 5.5, p.window, 2.0);
    } else {
        canvas.fill(1.0, top, 18.0, 18.0, 4.0, p.surface);
        canvas.stroke(
            1.0,
            top,
            18.0,
            18.0,
            4.0,
            if state.hot { p.accent } else { p.faint },
            1.5,
        );
    }
    canvas.text(
        label,
        (30.0, top, w - 30.0, 18.0),
        13.0,
        400,
        p.text,
        Align::Left,
        false,
    );
    if state.focused {
        canvas.stroke(0.0, 0.0, w, h, 6.0, p.accent, 2.0);
    }
}

/// A rounded avatar with initials.
pub unsafe fn avatar(canvas: &Canvas, p: &Palette, cx: f32, cy: f32, r: f32, initials: &str) {
    canvas.circle(cx, cy, r, p.accent_soft);
    canvas.text(
        initials,
        (cx - r, cy - r, r * 2.0, r * 2.0),
        r * 0.72,
        600,
        p.accent,
        Align::Center,
        true,
    );
}

/// A small status pill with a coloured outline.
pub unsafe fn pill(
    canvas: &Canvas,
    (x, y, w, h): (f32, f32, f32, f32),
    label: &str,
    fill: Color,
    line: Color,
    ink: Color,
) {
    canvas.fill(x, y, w, h, h / 2.0, fill);
    canvas.stroke(x, y, w, h, h / 2.0, line, 1.0);
    canvas.text(label, (x, y, w, h), 11.5, 600, ink, Align::Center, true);
}

#[derive(Clone, Copy)]
pub enum Icon {
    Eye,
    Monitor,
    Lock,
    Pause,
    Stop,
    Dot,
}

/// Simple line icons in a 16x16 box at (x, y).
pub unsafe fn icon(canvas: &Canvas, icon: Icon, x: f32, y: f32, color: Color) {
    match icon {
        Icon::Eye => {
            canvas.ring(x + 8.0, y + 8.0, 7.0, color, 1.4);
            canvas.circle(x + 8.0, y + 8.0, 2.4, color);
        }
        Icon::Monitor => {
            canvas.stroke(x + 1.0, y + 2.0, 14.0, 9.0, 2.0, color, 1.4);
            canvas.line(x + 5.0, y + 14.0, x + 11.0, y + 14.0, color, 1.4);
            canvas.line(x + 8.0, y + 11.0, x + 8.0, y + 14.0, color, 1.4);
        }
        Icon::Lock => {
            canvas.stroke(x + 3.0, y + 7.0, 10.0, 7.5, 2.0, color, 1.4);
            canvas.ring(x + 8.0, y + 6.0, 3.2, color, 1.4);
        }
        Icon::Pause => {
            canvas.fill(x + 3.5, y + 2.5, 3.0, 11.0, 1.0, color);
            canvas.fill(x + 9.5, y + 2.5, 3.0, 11.0, 1.0, color);
        }
        Icon::Stop => {
            canvas.stroke(x + 2.0, y + 2.0, 12.0, 12.0, 2.5, color, 1.6);
        }
        Icon::Dot => canvas.circle(x + 8.0, y + 8.0, 4.0, color),
    }
}

/// Two-letter initials from an account name such as `alex.morgan@example.test`.
pub fn initials(name: &str) -> String {
    let local = name.split('@').next().unwrap_or(name);
    let mut letters = local
        .split(|c: char| !c.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.chars().next());
    let first = letters.next();
    let second = letters.next();
    match (first, second) {
        (Some(a), Some(b)) => format!("{a}{b}").to_uppercase(),
        (Some(a), None) => local
            .chars()
            .take(2)
            .collect::<String>()
            .to_uppercase()
            .chars()
            .chain(std::iter::once(a))
            .take(2)
            .collect(),
        _ => "?".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initials_come_from_the_account_name() {
        assert_eq!(initials("alex.morgan@example.test"), "AM");
        assert_eq!(initials("input-d594071a-f954@example.test"), "ID");
        assert_eq!(initials("sam@example.test"), "SA");
        assert_eq!(initials("@@"), "?");
    }
    #[test]
    fn colors_convert_to_the_windows_byte_order() {
        assert_eq!(colorref(0xFF11_2233), 0x0033_2211);
    }
}
