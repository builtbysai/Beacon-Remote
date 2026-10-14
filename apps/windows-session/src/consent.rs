//! Local approval with cancellation, a monotonic deadline and default decline.
//!
//! The window follows the approved design (ADR 0029): who is asking, what they would see and do,
//! a choice between viewing only and allowing control, and Decline / Allow once. Real child
//! controls sit under the painting so keyboard and screen readers keep working, and Decline is
//! always the default.
use crate::native_ui::{self as ui, Icon, Palette, Role};
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use windows_sys::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC,
        DeleteObject, EndPaint, FillRect, GetStockObject, InvalidateRect, ScreenToClient,
        SelectObject, SetBkColor, SetBkMode, SetTextColor, HBRUSH, HDC, NULL_BRUSH, PAINTSTRUCT,
        SRCCOPY, TRANSPARENT,
    },
    System::{
        LibraryLoader::GetModuleHandleW,
        SystemServices::{SS_NOPREFIX, SS_RIGHT},
        Threading::GetCurrentThreadId,
    },
    UI::{
        Controls::{DRAWITEMSTRUCT, ODS_DISABLED, ODS_FOCUS, ODS_SELECTED},
        HiDpi::GetDpiForSystem,
        Input::KeyboardAndMouse::{GetFocus, SetFocus},
        WindowsAndMessaging::*,
    },
};

type Error = Box<dyn std::error::Error + Send + Sync>;

/// What the person chose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Declined,
    View,
    Control,
}

/// What the person chose: the access level, and whether the helper may also send files.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Access {
    pub decision: Decision,
    pub files: bool,
    pub recording: bool,
    /// The helper may hear what this computer is playing (ADR 0044). Never includes a microphone.
    pub audio: bool,
}
impl Access {
    const DECLINED: Self = Self {
        decision: Decision::Declined,
        files: false,
        recording: false,
        audio: false,
    };
}

const VIEW_CARD: i32 = 201;
const CONTROL_CARD: i32 = 202;
const FILES_BOX: i32 = 203;
const RECORD_BOX: i32 = 204;
const AUDIO_BOX: i32 = 205;
const HEADING: i32 = 301;
const SUBTITLE: i32 = 302;
const PANEL_TITLE: i32 = 303;
const ROW_ACTIVE: i32 = 304;
const ROW_FAINT: i32 = 305;
const SESSION_LINE: i32 = 306;
const TAG: i32 = 307;
const FOOTER: i32 = 308;
const REQUESTER: i32 = 309;

struct State {
    pending: Arc<AtomicBool>,
    deadline: Instant,
    accepted: bool,
    default_button: usize,
    message_loop_active: bool,
    // Presentation. Nothing here can grant anything: only Allow once, with `control` as chosen.
    palette: Palette,
    scale: f32,
    control_requested: bool,
    control_chosen: bool,
    files_chosen: bool,
    recording_chosen: bool,
    audio_chosen: bool,
    controller: String,
    session: String,
    hot: i32,
    surface_brush: HBRUSH,
    allowed: Decision,
}
impl State {
    fn new(pending: Arc<AtomicBool>, deadline: Instant) -> Self {
        Self {
            pending,
            deadline,
            accepted: false,
            default_button: IDNO as usize,
            message_loop_active: false,
            palette: ui::palette(),
            scale: 1.0,
            control_requested: false,
            control_chosen: false,
            files_chosen: false,
            recording_chosen: false,
            audio_chosen: false,
            controller: String::new(),
            session: String::new(),
            hot: 0,
            surface_brush: std::ptr::null_mut(),
            allowed: Decision::Declined,
        }
    }
    fn live(&self) -> bool {
        self.pending.load(Ordering::Acquire)
            && Instant::now() < self.deadline
            && crate::capture::desktop_receives_input()
    }
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

unsafe fn paint(window: HWND, state: &State) {
    let mut ps: PAINTSTRUCT = std::mem::zeroed();
    let hdc = BeginPaint(window, &mut ps);
    let mut client = RECT::default();
    GetClientRect(window, &mut client);
    let (w, h) = (client.right, client.bottom);
    let buffer = CreateCompatibleDC(hdc);
    let bitmap = CreateCompatibleBitmap(hdc, w, h);
    let old = SelectObject(buffer, bitmap);
    background(buffer, state, w, h);
    if let Some(canvas) = ui::Canvas::new(buffer, state.scale) {
        let p = &state.palette;
        // "Attended" pill beside the heading.
        ui::pill(
            &canvas,
            (406.0, 29.0, 86.0, 24.0),
            "Attended",
            p.warn_soft,
            p.warn_line,
            p.warn,
        );
        // Requester card.
        canvas.fill(28.0, 92.0, 464.0, 72.0, 10.0, p.surface);
        canvas.stroke(28.0, 92.0, 464.0, 72.0, 10.0, p.line, 1.0);
        ui::avatar(
            &canvas,
            p,
            66.0,
            128.0,
            20.0,
            &ui::initials(&state.controller),
        );
        // Access panel.
        canvas.fill(28.0, 178.0, 464.0, 176.0, 10.0, p.subtle);
        canvas.stroke(28.0, 178.0, 464.0, 176.0, 10.0, p.line, 1.0);
        ui::icon(&canvas, Icon::Eye, 44.0, 222.0, p.accent);
        ui::icon(
            &canvas,
            Icon::Monitor,
            44.0,
            246.0,
            if state.control_requested {
                p.accent
            } else {
                p.faint
            },
        );
        // Divider above the footer.
        canvas.line(28.0, 516.0, 492.0, 516.0, p.line, 1.0);
    }
    BitBlt(hdc, 0, 0, w, h, buffer, 0, 0, SRCCOPY);
    SelectObject(buffer, old);
    DeleteObject(bitmap);
    DeleteDC(buffer);
    EndPaint(window, &ps);
}

unsafe fn background(hdc: HDC, state: &State, w: i32, h: i32) {
    let brush = CreateSolidBrush(ui::colorref(state.palette.window));
    FillRect(
        hdc,
        &RECT {
            left: 0,
            top: 0,
            right: w,
            bottom: h,
        },
        brush,
    );
    DeleteObject(brush);
}

unsafe fn draw_item(state: &State, item: &DRAWITEMSTRUCT) {
    let w = (item.rcItem.right - item.rcItem.left) as f32 / state.scale;
    let h = (item.rcItem.bottom - item.rcItem.top) as f32 / state.scale;
    // The control paints its own background first, so rounded corners meet the window.
    let id = item.CtlID as i32;
    // The check box sits on the access panel, not on the window.
    let backdrop = if id == FILES_BOX || id == RECORD_BOX || id == AUDIO_BOX {
        state.palette.subtle
    } else {
        state.palette.window
    };
    let brush = CreateSolidBrush(ui::colorref(backdrop));
    FillRect(item.hDC, &item.rcItem, brush);
    DeleteObject(brush);
    let Some(canvas) = ui::Canvas::new(item.hDC, state.scale) else {
        return;
    };
    let flags = ui::State {
        hot: state.hot == id,
        pressed: item.itemState & ODS_SELECTED != 0,
        focused: item.itemState & ODS_FOCUS != 0,
        disabled: item.itemState & ODS_DISABLED != 0,
    };
    let p = &state.palette;
    match id {
        VIEW_CARD => ui::radio_card(
            &canvas,
            p,
            (w, h),
            "View only",
            "See the screen. No input.",
            !state.control_chosen,
            flags,
        ),
        CONTROL_CARD => ui::radio_card(
            &canvas,
            p,
            (w, h),
            "Allow control",
            if state.control_requested {
                "Mouse and keyboard access."
            } else {
                "Not requested."
            },
            state.control_chosen,
            flags,
        ),
        RECORD_BOX => ui::checkbox(
            &canvas,
            p,
            (w, h),
            "Also allow the helper to record this session (shown while it records)",
            state.recording_chosen,
            flags,
        ),
        AUDIO_BOX => ui::checkbox(
            &canvas,
            p,
            (w, h),
            "Also share this computer's sound (the helper hears what plays here)",
            state.audio_chosen,
            flags,
        ),
        FILES_BOX => ui::checkbox(
            &canvas,
            p,
            (w, h),
            "Also allow receiving files (saved in Downloads\\Beacon Remote)",
            state.files_chosen,
            flags,
        ),
        IDYES => ui::button(
            &canvas,
            p,
            (w, h),
            "Allow once",
            Role::Primary,
            ui::State {
                focused: flags.focused || state.default_button == IDYES as usize && flags.hot,
                ..flags
            },
        ),
        _ => ui::button(&canvas, p, (w, h), "Decline", Role::Secondary, flags),
    }
}

unsafe fn restyle_static(state: &State, hdc: HDC, id: i32) -> isize {
    let p = &state.palette;
    let color = match id {
        HEADING | PANEL_TITLE | REQUESTER => p.strong,
        SUBTITLE | SESSION_LINE | FOOTER => p.muted,
        TAG => p.faint,
        ROW_FAINT => p.faint,
        _ => p.text,
    };
    SetTextColor(hdc, ui::colorref(color));
    SetBkMode(hdc, TRANSPARENT as i32);
    GetStockObject(NULL_BRUSH) as isize
}

unsafe fn track_hover(window: HWND, state: &mut State) {
    let mut point = POINT::default();
    GetCursorPos(&mut point);
    ScreenToClient(window, &mut point);
    let over = ChildWindowFromPoint(window, point);
    let id = if over.is_null() || over == window {
        0
    } else {
        GetDlgCtrlID(over)
    };
    let hot = if matches!(
        id,
        IDYES | IDNO | VIEW_CARD | CONTROL_CARD | FILES_BOX | RECORD_BOX
    ) {
        id
    } else {
        0
    };
    if hot != state.hot {
        let before = state.hot;
        state.hot = hot;
        for changed in [before, hot] {
            if changed != 0 {
                InvalidateRect(GetDlgItem(window, changed), std::ptr::null(), 0);
            }
        }
    }
}

unsafe fn choose(window: HWND, state: &mut State, control: bool) {
    if control && !state.control_requested {
        return;
    }
    state.control_chosen = control;
    for id in [VIEW_CARD, CONTROL_CARD] {
        InvalidateRect(GetDlgItem(window, id), std::ptr::null(), 0);
    }
}

unsafe extern "system" fn procedure(
    window: HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if message == WM_NCCREATE {
        let creation = &*(lparam as *const CREATESTRUCTW);
        SetWindowLongPtrW(window, GWLP_USERDATA, creation.lpCreateParams as isize);
    }
    let state = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut State;
    if !state.is_null() {
        match message {
            WM_ERASEBKGND => return 1,
            WM_PAINT => {
                paint(window, &*state);
                return 0;
            }
            WM_DRAWITEM => {
                draw_item(&*state, &*(lparam as *const DRAWITEMSTRUCT));
                return 1;
            }
            WM_CTLCOLORSTATIC => {
                let id = GetDlgCtrlID(lparam as HWND);
                return restyle_static(&*state, wparam as HDC, id);
            }
            WM_CTLCOLOREDIT => {
                // The read-only requester line, flat on the card surface.
                SetTextColor(wparam as HDC, ui::colorref((*state).palette.strong));
                SetBkColor(wparam as HDC, ui::colorref((*state).palette.surface));
                return (*state).surface_brush as isize;
            }
            WM_COMMAND if wparam >> 16 == BN_CLICKED as usize => {
                match (wparam & 0xffff) as i32 {
                    VIEW_CARD => {
                        choose(window, &mut *state, false);
                        return 0;
                    }
                    CONTROL_CARD => {
                        choose(window, &mut *state, true);
                        return 0;
                    }
                    RECORD_BOX => {
                        (*state).recording_chosen = !(*state).recording_chosen;
                        InvalidateRect(GetDlgItem(window, RECORD_BOX), std::ptr::null(), 0);
                        return 0;
                    }
                    AUDIO_BOX => {
                        (*state).audio_chosen = !(*state).audio_chosen;
                        InvalidateRect(GetDlgItem(window, AUDIO_BOX), std::ptr::null(), 0);
                        return 0;
                    }
                    FILES_BOX => {
                        (*state).files_chosen = !(*state).files_chosen;
                        InvalidateRect(GetDlgItem(window, FILES_BOX), std::ptr::null(), 0);
                        return 0;
                    }
                    // Only the explicit Allow once can approve. A close, Escape, error, expired or
                    // cancelled request, or an unavailable desktop, denies.
                    id @ (IDYES | IDNO | IDCANCEL | IDOK) => {
                        let allowed = id == IDYES && (*state).live();
                        (*state).accepted = allowed;
                        (*state).allowed = if !allowed {
                            Decision::Declined
                        } else if (*state).control_chosen && (*state).control_requested {
                            Decision::Control
                        } else {
                            Decision::View
                        };
                        DestroyWindow(window);
                        return 0;
                    }
                    _ => {}
                }
            }
            WM_CLOSE => {
                (*state).accepted = false;
                (*state).allowed = Decision::Declined;
                DestroyWindow(window);
                return 0;
            }
            WM_TIMER if !(*state).live() => {
                (*state).accepted = false;
                (*state).allowed = Decision::Declined;
                DestroyWindow(window);
                return 0;
            }
            WM_TIMER => {
                track_hover(window, &mut *state);
                return 0;
            }
            DM_GETDEFID => {
                return ((DC_HASDEFID as usize) << 16 | (*state).default_button) as isize
            }
            DM_SETDEFID => {
                // Enter activates the focused button, but never silently changes the answer: the
                // default stays one of the two answer buttons.
                if !matches!(wparam as i32, IDNO | IDYES) {
                    return 0;
                }
                (*state).default_button = wparam;
                InvalidateRect(GetDlgItem(window, IDYES), std::ptr::null(), 0);
                InvalidateRect(GetDlgItem(window, IDNO), std::ptr::null(), 0);
                return 1;
            }
            _ => {}
        }
    }
    if message == WM_DESTROY {
        KillTimer(window, 1);
        // A cancelled request can destroy its window before entering the pump.
        // Do not leave WM_QUIT queued for a later request on this pooled thread.
        if !state.is_null() && (*state).message_loop_active {
            PostQuitMessage(0);
        }
        return 0;
    }
    if message == WM_NCDESTROY {
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
    }
    DefWindowProcW(window, message, wparam, lparam)
}

#[cfg(test)]
pub fn request(
    controller: &str,
    pending: Arc<AtomicBool>,
    deadline: Instant,
) -> Result<bool, Error> {
    Ok(request_access(
        controller,
        pending,
        deadline,
        false,
        false,
        "Primary display",
        "S-0000",
    )?
    .decision
        != Decision::Declined)
}

pub fn request_access(
    controller: &str,
    pending: Arc<AtomicBool>,
    deadline: Instant,
    control: bool,
    unlimited: bool,
    display: &str,
    session: &str,
) -> Result<Access, Error> {
    let mut state = State::new(pending, deadline);
    if !state.live() {
        return Ok(Access::DECLINED);
    }
    // Keep the complete account identity; control characters never reach the window.
    state.controller = controller
        .chars()
        .filter(|character| !character.is_control())
        .collect();
    state.session = session.to_owned();
    state.control_requested = control;
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        if instance.is_null() {
            return Err(io::Error::last_os_error().into());
        }
        // The blocking pool can host more than one test/request thread. A class
        // belongs only to this invocation and is unregistered before return.
        let class = wide(&format!("BeaconRemoteConsent-{}", GetCurrentThreadId()));
        let definition = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hIcon: LoadIconW(instance, 1 as _),
            ..Default::default()
        };
        if RegisterClassW(&definition) == 0 {
            return Err(io::Error::last_os_error().into());
        }
        let result = (|| -> Result<Access, Error> {
            let dpi = GetDpiForSystem().max(96);
            let factor = dpi as f32 / 96.0;
            state.scale = factor;
            let scale = move |value: i32| (value as f32 * factor).round() as i32;
            state.surface_brush = CreateSolidBrush(ui::colorref(state.palette.surface));
            let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
            let mut bounds = RECT {
                left: 0,
                top: 0,
                right: scale(520),
                bottom: scale(574),
            };
            if AdjustWindowRectEx(&mut bounds, style, 0, WS_EX_TOPMOST) == 0 {
                return Err(io::Error::last_os_error().into());
            }
            let title = wide("Beacon Remote — incoming connection request");
            let window = CreateWindowExW(
                WS_EX_TOPMOST,
                class.as_ptr(),
                title.as_ptr(),
                style,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                bounds.right - bounds.left,
                bounds.bottom - bounds.top,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::from_mut(&mut state).cast(),
            );
            if window.is_null() {
                return Err(io::Error::last_os_error().into());
            }
            ui::style_title_bar(window as isize, ui::dark_mode());
            let initialized = (|| -> Result<(), Error> {
                let text_class = wide("STATIC");
                let make_text =
                    |id: i32, text: &str, x: i32, y: i32, w: i32, h: i32, extra: u32| {
                        CreateWindowExW(
                            0,
                            text_class.as_ptr(),
                            wide(text).as_ptr(),
                            WS_CHILD | WS_VISIBLE | SS_NOPREFIX | extra,
                            scale(x),
                            scale(y),
                            scale(w),
                            scale(h),
                            window,
                            id as usize as _,
                            instance,
                            std::ptr::null(),
                        )
                    };
                let session_line = format!("Session {} · {}", state.session, display);
                let lifetime = if unlimited {
                    "Until stopped"
                } else {
                    "Up to two minutes"
                };
                let heading = make_text(HEADING, "Incoming connection request", 28, 26, 370, 30, 0);
                let subtitle = make_text(
                    SUBTITLE,
                    "Someone is requesting access to this computer.",
                    28,
                    58,
                    464,
                    20,
                    0,
                );
                // The full requester identity stays selectable in a read-only line.
                // A long address wraps to two smaller lines instead of being cut off.
                let long_name = state.controller.chars().count() > 26;
                let requester = CreateWindowExW(
                    0,
                    wide("EDIT").as_ptr(),
                    wide(&state.controller).as_ptr(),
                    WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_READONLY as u32 | ES_MULTILINE as u32,
                    scale(96),
                    scale(if long_name { 98 } else { 106 }),
                    scale(280),
                    scale(if long_name { 42 } else { 22 }),
                    window,
                    REQUESTER as usize as _,
                    instance,
                    std::ptr::null(),
                );
                let session_text = make_text(
                    SESSION_LINE,
                    &session_line,
                    96,
                    if long_name { 142 } else { 138 },
                    280,
                    18,
                    0,
                );
                let tag = make_text(TAG, "REQUESTER", 388, 119, 92, 16, SS_RIGHT);
                let panel_title = make_text(PANEL_TITLE, "Access requested", 44, 190, 300, 20, 0);
                let row_view = make_text(ROW_ACTIVE, "View this desktop", 70, 220, 410, 20, 0);
                let row_control = make_text(
                    if control { ROW_ACTIVE } else { ROW_FAINT },
                    if control {
                        "Mouse and keyboard control (you choose below)"
                    } else {
                        "Mouse and keyboard control not requested"
                    },
                    70,
                    244,
                    410,
                    20,
                    0,
                );
                let footer = make_text(
                    FOOTER,
                    &format!(
                        "{lifetime} · Stop sharing anytime, or lock Windows. The request expires without approval and no persistent permission is granted."
                    ),
                    28,
                    526,
                    464,
                    38,
                    0,
                );
                let button_class = wide("BUTTON");
                let make_button =
                    |id: i32, label: &str, x: i32, y: i32, w: i32, h: i32, extra: u32| {
                        CreateWindowExW(
                            0,
                            button_class.as_ptr(),
                            wide(label).as_ptr(),
                            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_OWNERDRAW as u32 | extra,
                            scale(x),
                            scale(y),
                            scale(w),
                            scale(h),
                            window,
                            id as usize as _,
                            instance,
                            std::ptr::null(),
                        )
                    };
                let view_card = make_button(VIEW_CARD, "View only", 28, 370, 226, 64, 0);
                let control_card = make_button(
                    CONTROL_CARD,
                    "Allow control",
                    266,
                    370,
                    226,
                    64,
                    if control { 0 } else { WS_DISABLED },
                );
                let files_box = make_button(FILES_BOX, "", 44, 264, 440, 26, 0);
                let record_box = make_button(RECORD_BOX, "", 44, 292, 440, 26, 0);
                let audio_box = make_button(AUDIO_BOX, "", 44, 320, 440, 26, 0);
                let decline = make_button(IDNO, "Decline", 248, 454, 104, 40, 0);
                let allow = make_button(IDYES, "Allow once", 364, 454, 128, 40, 0);
                let controls = [
                    heading,
                    subtitle,
                    requester,
                    session_text,
                    tag,
                    panel_title,
                    row_view,
                    row_control,
                    footer,
                    view_card,
                    control_card,
                    files_box,
                    record_box,
                    audio_box,
                    decline,
                    allow,
                ];
                if controls.iter().any(|handle| handle.is_null())
                    || SetTimer(window, 1, 100, None) == 0
                {
                    return Err(io::Error::last_os_error().into());
                }
                // Fonts: a larger semibold heading, regular body text.
                let px = move |value: i32| (value as f32 * factor).round() as i32;
                let heading_font = ui::gdi_font(px(21), 600);
                let strong_font = ui::gdi_font(px(15), 600);
                let requester_font = if long_name {
                    ui::gdi_font(px(13), 600)
                } else {
                    strong_font
                };
                let body_font = ui::gdi_font(px(13), 400);
                let small_font = ui::gdi_font(px(12), 400);
                let tag_font = ui::gdi_font(px(11), 600);
                for (handle, font) in [
                    (heading, heading_font),
                    (requester, requester_font),
                    (panel_title, strong_font),
                    (subtitle, body_font),
                    (row_view, body_font),
                    (row_control, body_font),
                    (session_text, small_font),
                    (footer, small_font),
                    (tag, tag_font),
                ] {
                    SendMessageW(handle, WM_SETFONT, font as usize, 1);
                }
                // Recheck before showing: cancellation during initialization cannot
                // leave a stale request visible or permit a stale approval.
                if !state.live() {
                    return Ok(());
                }
                state.message_loop_active = true;
                ShowWindow(window, SW_SHOW);
                if SetForegroundWindow(window) == 0 {
                    FlashWindowEx(&FLASHWINFO {
                        cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                        hwnd: window,
                        dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
                        uCount: 3,
                        dwTimeout: 0,
                    });
                }
                SetFocus(decline);
                let mut message = MSG::default();
                loop {
                    match GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) {
                        -1 => return Err(io::Error::last_os_error().into()),
                        0 => break,
                        _ => {
                            if IsDialogMessageW(window, &message) == 0 {
                                TranslateMessage(&message);
                                DispatchMessageW(&message);
                            }
                        }
                    }
                }
                for font in [heading_font, strong_font, body_font, small_font, tag_font] {
                    ui::delete_font(font);
                }
                if long_name {
                    ui::delete_font(requester_font);
                }
                Ok(())
            })();
            state.message_loop_active = false;
            if IsWindow(window) != 0 {
                DestroyWindow(window);
            }
            if !state.surface_brush.is_null() {
                DeleteObject(state.surface_brush);
                state.surface_brush = std::ptr::null_mut();
            }
            let _ = GetFocus();
            initialized?;
            Ok(if state.accepted && state.live() {
                Access {
                    decision: state.allowed,
                    files: state.files_chosen && state.allowed != Decision::Declined,
                    recording: state.recording_chosen && state.allowed != Decision::Declined,
                    audio: state.audio_chosen && state.allowed != Decision::Declined,
                }
            } else {
                Access::DECLINED
            })
        })();
        UnregisterClassW(class.as_ptr(), instance);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleanup_only_quits_an_active_message_loop() {
        // Use one fresh OS thread for both lifetimes, as Tokio's blocking pool
        // can reuse a consent thread. Hidden windows never ask for approval or
        // capture; this exercises the real Win32 destruction/queue boundary.
        std::thread::spawn(|| unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = wide(&format!(
                "BeaconConsentCleanupTest-{}",
                GetCurrentThreadId()
            ));
            let definition = WNDCLASSW {
                lpfnWndProc: Some(procedure),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                ..Default::default()
            };
            assert_ne!(RegisterClassW(&definition), 0);
            let mut state = State::new(Arc::new(AtomicBool::new(false)), Instant::now());
            for pumping in [false, true, false] {
                state.message_loop_active = pumping;
                let window = CreateWindowExW(
                    0,
                    class.as_ptr(),
                    class.as_ptr(),
                    0,
                    0,
                    0,
                    1,
                    1,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::from_mut(&mut state).cast(),
                );
                assert!(!window.is_null());
                assert_ne!(DestroyWindow(window), 0);
                let mut message = MSG::default();
                assert_eq!(
                    PeekMessageW(
                        &mut message,
                        std::ptr::null_mut(),
                        WM_QUIT,
                        WM_QUIT,
                        PM_REMOVE
                    ) != 0,
                    pumping,
                );
            }
            assert_ne!(UnregisterClassW(class.as_ptr(), instance), 0);
        })
        .join()
        .unwrap();
    }

    #[test]
    fn cancelled_and_expired_requests_never_open_approval() {
        let future = Instant::now() + std::time::Duration::from_secs(1);
        assert!(!request(
            "fixture@example.invalid",
            Arc::new(AtomicBool::new(false)),
            future
        )
        .unwrap());
        assert!(!request(
            "fixture@example.invalid",
            Arc::new(AtomicBool::new(true)),
            Instant::now()
        )
        .unwrap());
    }
}
