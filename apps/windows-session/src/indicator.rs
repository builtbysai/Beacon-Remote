//! Native visible Stop control and active-sharing card (ADR 0029). The window thread owns its atomic
//! state lifetime. It shows who is connected and what they can do, with Pause and a hard Stop.
use crate::files_transport::Permissions;
use crate::native_ui::{self as ui, Icon, Role};
use std::{
    io,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Instant,
};
use windows_sys::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC,
        DeleteObject, EndPaint, FillRect, GetStockObject, InvalidateRect, ScreenToClient,
        SelectObject, SetBkColor, SetBkMode, SetTextColor, NULL_BRUSH, PAINTSTRUCT, SRCCOPY,
        TRANSPARENT,
    },
    System::{
        LibraryLoader::GetModuleHandleW,
        SystemServices::{SS_NOPREFIX, SS_RIGHT},
    },
    UI::{
        Controls::{DRAWITEMSTRUCT, ODS_FOCUS, ODS_SELECTED},
        HiDpi::GetDpiForSystem,
        Input::KeyboardAndMouse::SetFocus,
        WindowsAndMessaging::*,
    },
};
type Error = Box<dyn std::error::Error + Send + Sync>;
const STOP_ID: i32 = 1001;
const STATUS_ID: i32 = 1002;
const PAUSE_ID: i32 = 1003;
const SEND_ID: i32 = 1004;
const REVOKE_ID: i32 = 1005;
const MUTE_ID: i32 = 1019;
const HEADING_ID: i32 = 1010;
const NAME_ID: i32 = 1011;
const SESSION_ID: i32 = 1012;
const TAG_ID: i32 = 1013;
const PANEL_ID: i32 = 1014;
const ROW_VIEW_ID: i32 = 1015;
const ROW_INPUT_ID: i32 = 1016;
const ROW_LIMITS_ID: i32 = 1017;
const FOOTER_ID: i32 = 1018;
// The inline request for more access, shown inside this card while one is pending.
const PROMPT_TITLE_ID: i32 = 1030;
const PROMPT_DETAIL_ID: i32 = 1031;
const PROMPT_DECLINE_ID: i32 = 1032;
const PROMPT_ALLOW_ID: i32 = 1033;
const BASE_HEIGHT: i32 = 480;
const PROMPT_HEIGHT: i32 = 640;

/// A request for more access, answered inside the sharing card so no second window opens. Decline is the default
/// and every other outcome (expiry, cancellation, lock, the card closing) declines.
pub(crate) struct Card {
    // 0 idle, 1 asking, 2 allowed, 3 declined.
    ask: AtomicU8,
    detail: std::sync::Mutex<String>,
    // True while the card's window exists and its safety timer runs.
    open: AtomicBool,
}
const IDLE: u8 = 0;
const ASKING: u8 = 1;
const ALLOWED: u8 = 2;
const DECLINED: u8 = 3;
impl Card {
    fn new() -> Self {
        Self {
            ask: AtomicU8::new(IDLE),
            detail: std::sync::Mutex::new(String::new()),
            open: AtomicBool::new(false),
        }
    }
    /// Asks the person at this computer. Blocks until they answer, `pending` clears or `deadline` passes.
    /// Returns false for everything except an explicit Allow once.
    pub(crate) fn ask(&self, detail: &str, pending: &AtomicBool, deadline: Instant) -> bool {
        if !self.open.load(Ordering::Acquire)
            || self
                .ask
                .compare_exchange(IDLE, ASKING, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return false;
        }
        if let Ok(mut text) = self.detail.lock() {
            *text = detail.to_owned();
        }
        let answer = loop {
            match self.ask.load(Ordering::Acquire) {
                ALLOWED => break pending.load(Ordering::Acquire) && Instant::now() < deadline,
                DECLINED => break false,
                _ => {}
            }
            if !pending.load(Ordering::Acquire)
                || Instant::now() >= deadline
                || !self.open.load(Ordering::Acquire)
            {
                break false;
            }
            thread::sleep(std::time::Duration::from_millis(25));
        };
        self.ask.store(IDLE, Ordering::Release);
        answer
    }
}
// The sharing card of the session in progress, if any. Only one session shares at a time.
static CARD: std::sync::Mutex<Option<Arc<Card>>> = std::sync::Mutex::new(None);
/// Asks inside the open sharing card. `None` when there is no card, so the caller can use its own window.
pub(crate) fn ask_in_card(detail: &str, pending: &AtomicBool, deadline: Instant) -> Option<bool> {
    let card = CARD.lock().ok()?.clone()?;
    card.open
        .load(Ordering::Acquire)
        .then(|| card.ask(detail, pending, deadline))
}

struct WindowState {
    active: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    desktop: bool,
    control: Arc<AtomicBool>,
    // The helper may send files (chosen in the consent window); received files are announced here.
    extras: Arc<AtomicU8>,
    // The helper hears what this computer plays; said plainly in the permissions row.
    audio: bool,
    deadline: Option<Instant>,
    controller: String,
    session: String,
    // Whole thousandths of the display scale, so the thread can set it after creation.
    scale_milli: std::sync::atomic::AtomicU32,
    palette: ui::Palette,
    hot: AtomicU8,
    // What was last painted (connected, paused), so a change repaints the card.
    drawn: AtomicU8,
    card: Arc<Card>,
    // Whether the inline request is currently on screen.
    prompt_shown: AtomicBool,
}
impl WindowState {
    fn new(
        active: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
        desktop: bool,
        control: Arc<AtomicBool>,
        deadline: Option<Instant>,
    ) -> Self {
        Self {
            active,
            connected,
            desktop,
            control,
            extras: Arc::default(),
            audio: false,
            deadline,
            controller: String::new(),
            session: String::new(),
            scale_milli: std::sync::atomic::AtomicU32::new(1000),
            palette: ui::palette(),
            hot: AtomicU8::new(0),
            drawn: AtomicU8::new(255),
            card: Arc::new(Card::new()),
            prompt_shown: AtomicBool::new(false),
        }
    }
    fn scale(&self) -> f32 {
        self.scale_milli.load(Ordering::Acquire) as f32 / 1000.0
    }
    fn live(&self) -> bool {
        self.active.load(Ordering::Acquire)
            && self.deadline.is_none_or(|end| Instant::now() < end)
            && (!self.desktop || crate::capture::desktop_receives_input())
    }
    fn mode(&self) -> u8 {
        let extras = Permissions::read(&self.extras);
        u8::from(self.connected.load(Ordering::Acquire))
            | (u8::from(crate::pause::is_paused()) << 1)
            | (u8::from(self.control.load(Ordering::Acquire)) << 2)
            | (u8::from(extras.files) << 3)
            | (u8::from(extras.recording) << 4)
    }
}
pub struct Indicator {
    card: Arc<Card>,
    active: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
unsafe fn dispatch(window: HWND, message: &MSG) {
    if IsDialogMessageW(window, message) == 0 {
        TranslateMessage(message);
        DispatchMessageW(message);
    }
}

unsafe fn paint(window: HWND, state: &WindowState) {
    let mut ps: PAINTSTRUCT = std::mem::zeroed();
    let hdc = BeginPaint(window, &mut ps);
    let mut client = RECT::default();
    GetClientRect(window, &mut client);
    let (w, h) = (client.right, client.bottom);
    let buffer = CreateCompatibleDC(hdc);
    let bitmap = CreateCompatibleBitmap(hdc, w, h);
    let old = SelectObject(buffer, bitmap);
    let p = &state.palette;
    let brush = CreateSolidBrush(ui::colorref(p.window));
    FillRect(
        buffer,
        &RECT {
            left: 0,
            top: 0,
            right: w,
            bottom: h,
        },
        brush,
    );
    DeleteObject(brush);
    if let Some(canvas) = ui::Canvas::new(buffer, state.scale()) {
        let paused = crate::pause::is_paused();
        let connected = state.connected.load(Ordering::Acquire);
        let asking = state.prompt_shown.load(Ordering::Acquire);
        let (label, fill, line, ink) = if asking {
            ("Request", p.warn_soft, p.warn_line, p.warn)
        } else if paused {
            ("Paused", p.warn_soft, p.warn_line, p.warn)
        } else if connected {
            ("Connected", p.success_soft, p.success, p.success)
        } else {
            ("Connecting", p.accent_soft, p.accent, p.accent)
        };
        ui::pill(&canvas, (398.0, 29.0, 94.0, 24.0), label, fill, line, ink);
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
        canvas.fill(28.0, 178.0, 464.0, 120.0, 10.0, p.subtle);
        canvas.stroke(28.0, 178.0, 464.0, 120.0, 10.0, p.line, 1.0);
        let live_view = state.desktop && !paused;
        let live_input = state.desktop && state.control.load(Ordering::Acquire) && !paused;
        ui::icon(
            &canvas,
            Icon::Eye,
            44.0,
            222.0,
            if live_view { p.accent } else { p.faint },
        );
        ui::icon(
            &canvas,
            Icon::Monitor,
            44.0,
            246.0,
            if live_input { p.accent } else { p.faint },
        );
        ui::icon(
            &canvas,
            Icon::Lock,
            44.0,
            270.0,
            if Permissions::read(&state.extras) != Permissions::default() || state.audio {
                p.accent
            } else {
                p.faint
            },
        );
        canvas.line(28.0, 372.0, 492.0, 372.0, p.line, 1.0);
        if asking {
            canvas.fill(28.0, 482.0, 464.0, 138.0, 10.0, p.warn_soft);
            canvas.stroke(28.0, 482.0, 464.0, 138.0, 10.0, p.warn_line, 1.0);
        }
    }
    BitBlt(hdc, 0, 0, w, h, buffer, 0, 0, SRCCOPY);
    SelectObject(buffer, old);
    DeleteObject(bitmap);
    DeleteDC(buffer);
    EndPaint(window, &ps);
}

unsafe fn draw_item(state: &WindowState, item: &DRAWITEMSTRUCT) {
    let scale = state.scale();
    let w = (item.rcItem.right - item.rcItem.left) as f32 / scale;
    let h = (item.rcItem.bottom - item.rcItem.top) as f32 / scale;
    let brush = CreateSolidBrush(ui::colorref(state.palette.window));
    FillRect(item.hDC, &item.rcItem, brush);
    DeleteObject(brush);
    let Some(canvas) = ui::Canvas::new(item.hDC, scale) else {
        return;
    };
    let id = item.CtlID as i32;
    let flags = ui::State {
        hot: i32::from(state.hot.load(Ordering::Acquire)) == id - 1000,
        pressed: item.itemState & ODS_SELECTED != 0,
        focused: item.itemState & ODS_FOCUS != 0,
        disabled: false,
    };
    if id == PROMPT_ALLOW_ID {
        ui::button(
            &canvas,
            &state.palette,
            (w, h),
            "Allow once",
            Role::Primary,
            flags,
        );
    } else if id == PROMPT_DECLINE_ID {
        ui::button(
            &canvas,
            &state.palette,
            (w, h),
            "Decline",
            Role::Secondary,
            flags,
        );
    } else if id == PAUSE_ID {
        let label = if crate::pause::is_paused() {
            "Resume sharing"
        } else {
            "Pause sharing"
        };
        ui::button(
            &canvas,
            &state.palette,
            (w, h),
            label,
            Role::Secondary,
            flags,
        );
    } else if id == MUTE_ID {
        let label = if crate::audio::muted() {
            "Unmute sound"
        } else {
            "Mute sound"
        };
        ui::button(
            &canvas,
            &state.palette,
            (w, h),
            label,
            Role::Secondary,
            flags,
        );
    } else if id == SEND_ID {
        ui::button(
            &canvas,
            &state.palette,
            (w, h),
            "Send a file…",
            Role::Secondary,
            flags,
        );
    } else if id == REVOKE_ID {
        ui::button(
            &canvas,
            &state.palette,
            (w, h),
            "Turn off file and recording access",
            Role::Secondary,
            flags,
        );
    } else {
        ui::button(
            &canvas,
            &state.palette,
            (w, h),
            "Stop sharing",
            Role::Danger,
            flags,
        );
    }
}

/// The standard Windows open dialog, owned by the sharing window. The person at this computer picks the file;
/// nothing is sent until the helper accepts it.
/// The permissions row: what the helper may do beyond looking, and what is happening right now. While the
/// helper records, that is said plainly.
fn extras_line(files: bool, recording: bool, audio: bool, note: &str) -> String {
    let line = permissions_line(files, recording, note);
    match (audio, line) {
        (false, line) => line,
        (true, line) if line.starts_with('●') => format!("{line} · sound shared"),
        (true, line) if line.ends_with("not allowed") => "Sound shared with the helper".to_string(),
        (true, line) => format!("{line} · sound shared"),
    }
}

fn permissions_line(files: bool, recording: bool, note: &str) -> String {
    if recording && crate::files::recording() {
        return "● Recording · the helper is recording this session".to_string();
    }
    if files && !note.is_empty() {
        return format!("File transfer · {note}");
    }
    match (files, recording) {
        (true, true) => "File transfer and recording allowed".to_string(),
        (true, false) => "File transfer allowed · saved in Downloads\\Beacon Remote".to_string(),
        (false, true) => "Recording allowed · shown while it records".to_string(),
        (false, false) => "File transfer and recording not allowed".to_string(),
    }
}

unsafe fn choose_file(window: HWND) -> Option<std::path::PathBuf> {
    use windows_sys::Win32::UI::Controls::Dialogs::{
        GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_PATHMUSTEXIST,
        OPENFILENAMEW,
    };
    let mut buffer = vec![0u16; 32768];
    let title = wide("Choose a file to send to the helper");
    let mut dialog: OPENFILENAMEW = std::mem::zeroed();
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.hwndOwner = window;
    dialog.lpstrFile = buffer.as_mut_ptr();
    dialog.nMaxFile = buffer.len() as u32;
    dialog.lpstrTitle = title.as_ptr();
    dialog.Flags = OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY;
    if GetOpenFileNameW(&mut dialog) == 0 {
        return None;
    }
    let length = buffer.iter().position(|unit| *unit == 0)?;
    Some(std::path::PathBuf::from(String::from_utf16_lossy(
        &buffer[..length],
    )))
}

unsafe fn track_hover(window: HWND, state: &WindowState) {
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
        STOP_ID | PAUSE_ID | SEND_ID | MUTE_ID | PROMPT_DECLINE_ID | PROMPT_ALLOW_ID
    ) {
        (id - 1000) as u8
    } else {
        0
    };
    if state.hot.swap(hot, Ordering::AcqRel) != hot {
        for button in [
            STOP_ID,
            PAUSE_ID,
            SEND_ID,
            MUTE_ID,
            PROMPT_DECLINE_ID,
            PROMPT_ALLOW_ID,
        ] {
            InvalidateRect(GetDlgItem(window, button), std::ptr::null(), 0);
        }
    }
}

/// The card's request state for a window's shared state pointer.
unsafe fn card_of<'a>(state: *const WindowState) -> &'a Card {
    &(*state).card
}
/// Shows or hides the inline request and resizes the card to fit. Stop never moves: the request is added below it.
unsafe fn set_prompt(window: HWND, state: &WindowState, show: bool) {
    if state.prompt_shown.swap(show, Ordering::AcqRel) == show {
        return;
    }
    let scale = state.scale();
    if show {
        let detail = state
            .card
            .detail
            .lock()
            .map(|text| text.clone())
            .unwrap_or_default();
        SetWindowTextW(GetDlgItem(window, PROMPT_DETAIL_ID), wide(&detail).as_ptr());
    }
    for id in [
        PROMPT_TITLE_ID,
        PROMPT_DETAIL_ID,
        PROMPT_DECLINE_ID,
        PROMPT_ALLOW_ID,
    ] {
        ShowWindow(GetDlgItem(window, id), if show { SW_SHOW } else { SW_HIDE });
    }
    let mut bounds = RECT {
        left: 0,
        top: 0,
        right: (520.0 * scale).round() as i32,
        bottom: ((if show { PROMPT_HEIGHT } else { BASE_HEIGHT }) as f32 * scale).round() as i32,
    };
    AdjustWindowRectEx(
        &mut bounds,
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
        0,
        WS_EX_TOPMOST,
    );
    let mut outer = RECT::default();
    GetWindowRect(window, &mut outer);
    let mut work = RECT::default();
    SystemParametersInfoW(SPI_GETWORKAREA, 0, std::ptr::addr_of_mut!(work).cast(), 0);
    let height = bounds.bottom - bounds.top;
    // Keep the whole card, including Stop, on screen.
    let top = outer.top.min(work.bottom - height).max(work.top);
    SetWindowPos(
        window,
        std::ptr::null_mut(),
        outer.left,
        top,
        bounds.right - bounds.left,
        height,
        SWP_NOZORDER | SWP_NOACTIVATE,
    );
    InvalidateRect(window, std::ptr::null(), 0);
    if show {
        if SetForegroundWindow(window) == 0 {
            FlashWindowEx(&FLASHWINFO {
                cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                hwnd: window,
                dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
                uCount: 3,
                dwTimeout: 0,
            });
        }
        // Decline is the default answer.
        SetFocus(GetDlgItem(window, PROMPT_DECLINE_ID));
    } else {
        SetFocus(GetDlgItem(window, STOP_ID));
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
    let state = GetWindowLongPtrW(window, GWLP_USERDATA) as *const WindowState;
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
                let p = &(*state).palette;
                let color = match GetDlgCtrlID(lparam as HWND) {
                    HEADING_ID | NAME_ID | PANEL_ID | PROMPT_TITLE_ID => p.strong,
                    STATUS_ID | SESSION_ID | FOOTER_ID => p.muted,
                    ROW_LIMITS_ID
                        if Permissions::read(&(*state).extras) != Permissions::default()
                            || (*state).audio =>
                    {
                        p.text
                    }
                    TAG_ID | ROW_LIMITS_ID => p.faint,
                    _ => p.text,
                };
                SetTextColor(wparam as _, ui::colorref(color));
                SetBkMode(wparam as _, TRANSPARENT as i32);
                return GetStockObject(NULL_BRUSH) as isize;
            }
            WM_CTLCOLOREDIT => {
                SetTextColor(wparam as _, ui::colorref((*state).palette.strong));
                SetBkColor(wparam as _, ui::colorref((*state).palette.surface));
                return ui::surface_brush((*state).palette.surface) as isize;
            }
            _ => {}
        }
    }
    if message == WM_COMMAND
        && wparam >> 16 == BN_CLICKED as usize
        && matches!(
            (wparam & 0xffff) as i32,
            PROMPT_ALLOW_ID | PROMPT_DECLINE_ID
        )
        && !state.is_null()
    {
        // Only the explicit Allow once, while the request is still pending and the desktop live, approves.
        let card = &(*state).card;
        let answer = if (wparam & 0xffff) as i32 == PROMPT_ALLOW_ID
            && card.ask.load(Ordering::Acquire) == ASKING
            && (*state).live()
        {
            ALLOWED
        } else {
            DECLINED
        };
        let _ = card
            .ask
            .compare_exchange(ASKING, answer, Ordering::AcqRel, Ordering::Acquire);
        set_prompt(window, &*state, false);
        return 0;
    }
    if message == WM_COMMAND
        && wparam >> 16 == BN_CLICKED as usize
        && matches!((wparam & 0xffff) as i32, IDCANCEL | IDOK)
        && !state.is_null()
        && (*state).prompt_shown.load(Ordering::Acquire)
    {
        // Escape or Enter with nothing focused declines the request; it never stops sharing by accident.
        let _ = card_of(state).ask.compare_exchange(
            ASKING,
            DECLINED,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        set_prompt(window, &*state, false);
        return 0;
    }
    if message == WM_COMMAND
        && wparam >> 16 == BN_CLICKED as usize
        && (wparam & 0xffff) as i32 == SEND_ID
        && !state.is_null()
    {
        let can_send = || {
            (*state).live()
                && (*state).connected.load(Ordering::Acquire)
                && Permissions::read(&(*state).extras).files
                && !crate::pause::is_paused()
        };
        if can_send() {
            if let Some(path) = choose_file(window).filter(|_| can_send()) {
                crate::files::request_send(path);
            }
        }
        return 0;
    }
    if message == WM_COMMAND
        && wparam >> 16 == BN_CLICKED as usize
        && (wparam & 0xffff) as i32 == REVOKE_ID
        && !state.is_null()
    {
        // Clears only the file and recording permissions added during this connection. The transport
        // stops any transfer and tells the viewer; screen and input continue as before.
        Permissions::default().publish(&(*state).extras);
        InvalidateRect(window, std::ptr::null(), 0);
        return 0;
    }
    if message == WM_COMMAND
        && wparam >> 16 == BN_CLICKED as usize
        && (wparam & 0xffff) as i32 == MUTE_ID
        && !state.is_null()
    {
        // Mute only stops sound toward the viewer; the picture, control and the session carry on.
        crate::audio::set_muted(!crate::audio::muted());
        InvalidateRect(GetDlgItem(window, MUTE_ID), std::ptr::null(), 0);
        return 0;
    }
    if message == WM_COMMAND
        && wparam >> 16 == BN_CLICKED as usize
        && (wparam & 0xffff) as i32 == PAUSE_ID
        && !state.is_null()
    {
        // Pause stops the screen and input at once without ending the session. It never starts
        // anything: resuming only lets the already-approved viewer see the screen again.
        crate::pause::toggle();
        InvalidateRect(window, std::ptr::null(), 0);
        InvalidateRect(GetDlgItem(window, PAUSE_ID), std::ptr::null(), 0);
        return 0;
    }
    if (message == WM_COMMAND
        && wparam >> 16 == BN_CLICKED as usize
        && matches!((wparam & 0xffff) as i32, STOP_ID | IDCANCEL | IDOK))
        || message == WM_CLOSE
    {
        if !state.is_null() {
            (*state).active.store(false, Ordering::Release);
        }
        DestroyWindow(window);
        return 0;
    }
    if message == WM_TIMER && !state.is_null() {
        // Enforce the lease and desktop boundary even while peer setup has no
        // capture worker yet. Unlocking never revives this request.
        if !(*state).live() {
            (*state).active.store(false, Ordering::Release);
            DestroyWindow(window);
            return 0;
        }
        track_hover(window, &*state);
        let asking = card_of(state).ask.load(Ordering::Acquire) == ASKING;
        if asking != (*state).prompt_shown.load(Ordering::Acquire) {
            set_prompt(window, &*state, asking);
        }
        let remaining = (*state)
            .deadline
            .map(|end| end.saturating_duration_since(Instant::now()));
        let seconds = remaining.map(|left| left.as_secs() + u64::from(left.subsec_nanos() > 0));
        let paused = crate::pause::is_paused();
        let status = if paused {
            "Sharing is paused · Screen and input are off"
        } else if (*state).connected.load(Ordering::Acquire) {
            if (*state).desktop {
                if (*state).control.load(Ordering::Acquire) {
                    "Sharing your screen · Mouse and keyboard control"
                } else {
                    "Sharing your screen · View only"
                }
            } else {
                "Synthetic video test · No desktop"
            }
        } else {
            "Connecting to viewer"
        };
        let text = wide(&match seconds {
            Some(seconds) => format!("{status} · {}:{:02} left", seconds / 60, seconds % 60),
            None => format!("{status} · Until stopped"),
        });
        let control = GetDlgItem(window, STATUS_ID);
        let mut current = [0_u16; 128];
        let length = GetWindowTextW(control, current.as_mut_ptr(), current.len() as i32).max(0);
        // Keep the fast safety timer, but only repaint/announce a changed status
        // or whole second instead of resetting accessible text ten times a second.
        if current[..length as usize] != text[..text.len() - 1] {
            SetWindowTextW(control, text.as_ptr());
            InvalidateRect(window, std::ptr::null(), 0);
        }
        {
            let extras = Permissions::read(&(*state).extras);
            let line = wide(&extras_line(
                extras.files,
                extras.recording,
                (*state).audio,
                &crate::files::status(),
            ));
            let row = GetDlgItem(window, ROW_LIMITS_ID);
            let mut shown = [0_u16; 160];
            let length = GetWindowTextW(row, shown.as_mut_ptr(), shown.len() as i32).max(0);
            if shown[..length as usize] != line[..line.len() - 1] {
                SetWindowTextW(row, line.as_ptr());
                InvalidateRect(window, std::ptr::null(), 0);
            }
        }
        let mode = (*state).mode();
        if (*state).drawn.swap(mode, Ordering::AcqRel) != mode {
            // Keep the permission rows in step with what is actually on.
            let paused_now = mode & 2 != 0;
            let view = wide(if paused_now {
                "Screen view paused"
            } else {
                "Screen view enabled"
            });
            let input = wide(if mode & 4 != 0 && !paused_now {
                "Keyboard and mouse enabled"
            } else {
                "Keyboard and mouse disabled"
            });
            SetWindowTextW(GetDlgItem(window, ROW_VIEW_ID), view.as_ptr());
            SetWindowTextW(GetDlgItem(window, ROW_INPUT_ID), input.as_ptr());
            ShowWindow(
                GetDlgItem(window, SEND_ID),
                if mode & 8 != 0 { SW_SHOWNA } else { SW_HIDE },
            );
            ShowWindow(
                GetDlgItem(window, REVOKE_ID),
                if mode & 24 != 0 { SW_SHOWNA } else { SW_HIDE },
            );
            InvalidateRect(window, std::ptr::null(), 0);
            InvalidateRect(GetDlgItem(window, PAUSE_ID), std::ptr::null(), 0);
        }
    }
    if message == DM_GETDEFID {
        let default = if !state.is_null() && (*state).prompt_shown.load(Ordering::Acquire) {
            PROMPT_DECLINE_ID
        } else {
            STOP_ID
        };
        return ((DC_HASDEFID as usize) << 16 | default as usize) as isize;
    }
    if message == DM_SETDEFID {
        let default = if !state.is_null() && (*state).prompt_shown.load(Ordering::Acquire) {
            PROMPT_DECLINE_ID
        } else {
            STOP_ID
        };
        return (wparam == default as usize) as isize;
    }
    if message == WM_DESTROY {
        if !state.is_null() {
            (*state).active.store(false, Ordering::Release);
            card_of(state).open.store(false, Ordering::Release);
        }
        KillTimer(window, 1);
        PostQuitMessage(0);
        return 0;
    }
    if message == WM_NCDESTROY {
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
    }
    DefWindowProcW(window, message, wparam, lparam)
}
impl Indicator {
    #[allow(clippy::too_many_arguments)]
    pub fn start_access(
        active: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
        desktop: bool,
        controller: String,
        deadline: Option<Instant>,
        control: Arc<AtomicBool>,
        extras: Arc<AtomicU8>,
        audio: bool,
        session: String,
    ) -> Result<Self, Error> {
        let (ready, received) = mpsc::channel();
        let mut state = WindowState::new(
            active.clone(),
            connected,
            desktop,
            control.clone(),
            deadline,
        );
        state.extras = extras;
        state.audio = audio && desktop;
        state.controller = controller
            .chars()
            .filter(|character| !character.is_control())
            .collect();
        state.session = session;
        let state = Arc::new(state);
        if !state.live() {
            active.store(false, Ordering::Release);
            return Err("View expired, stopped or input desktop unavailable".into());
        }
        let card = state.card.clone();
        let thread = thread::spawn(move || {
            let result = (|| -> Result<(), Error> {
                unsafe {
                    let instance = GetModuleHandleW(std::ptr::null());
                    if instance.is_null() {
                        return Err(io::Error::last_os_error().into());
                    }
                    let class = wide("BeaconRemoteVisibleStop");
                    let factor = GetDpiForSystem().max(96) as f32 / 96.0;
                    state
                        .scale_milli
                        .store((factor * 1000.0) as u32, Ordering::Release);
                    let scale = move |value: i32| (value as f32 * factor).round() as i32;
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
                    let title = wide(if desktop {
                        "Beacon Remote — screen sharing"
                    } else {
                        "Beacon Remote — synthetic video test (no desktop)"
                    });
                    let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
                    let mut bounds = RECT {
                        left: 0,
                        top: 0,
                        right: scale(520),
                        bottom: scale(BASE_HEIGHT),
                    };
                    if AdjustWindowRectEx(&mut bounds, style, 0, WS_EX_TOPMOST) == 0 {
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err(io::Error::last_os_error().into());
                    }
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
                        Arc::as_ptr(&state).cast(),
                    );
                    if window.is_null() {
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err(io::Error::last_os_error().into());
                    }
                    ui::style_title_bar(window as isize, ui::dark_mode());
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
                    let heading = make_text(
                        HEADING_ID,
                        if desktop {
                            "Someone is connected"
                        } else {
                            "Video test"
                        },
                        28,
                        26,
                        360,
                        30,
                        0,
                    );
                    let status_control =
                        make_text(STATUS_ID, "Connecting to viewer", 28, 58, 464, 20, 0);
                    let long_name = state.controller.chars().count() > 26;
                    let requester = CreateWindowExW(
                        0,
                        wide("EDIT").as_ptr(),
                        wide(&state.controller).as_ptr(),
                        WS_CHILD
                            | WS_VISIBLE
                            | WS_TABSTOP
                            | ES_READONLY as u32
                            | ES_MULTILINE as u32,
                        scale(96),
                        scale(if long_name { 98 } else { 106 }),
                        scale(280),
                        scale(if long_name { 42 } else { 22 }),
                        window,
                        NAME_ID as usize as _,
                        instance,
                        std::ptr::null(),
                    );
                    let session_text = make_text(
                        SESSION_ID,
                        &format!("Session {}", state.session),
                        96,
                        if long_name { 142 } else { 138 },
                        280,
                        18,
                        0,
                    );
                    let tag = make_text(TAG_ID, "REQUESTER", 388, 119, 92, 16, SS_RIGHT);
                    let panel = make_text(PANEL_ID, "Current permissions", 44, 190, 300, 20, 0);
                    let row_view = make_text(
                        ROW_VIEW_ID,
                        if desktop {
                            "Screen view enabled"
                        } else {
                            "No desktop is shared"
                        },
                        70,
                        220,
                        410,
                        20,
                        0,
                    );
                    let row_input = make_text(
                        ROW_INPUT_ID,
                        if control.load(Ordering::Acquire) && desktop {
                            "Keyboard and mouse enabled"
                        } else {
                            "Keyboard and mouse disabled"
                        },
                        70,
                        244,
                        410,
                        20,
                        0,
                    );
                    let extras = Permissions::read(&state.extras);
                    let row_limits = make_text(
                        ROW_LIMITS_ID,
                        &extras_line(extras.files, extras.recording, state.audio, ""),
                        70,
                        268,
                        410,
                        20,
                        0,
                    );
                    let footer = make_text(
                        FOOTER_ID,
                        "Stop sharing immediately revokes screen and input permission for this session.",
                        28,
                        420,
                        464,
                        38,
                        0,
                    );
                    let button = wide("BUTTON");
                    let make_button = |id: i32, label: &str, x: i32, y: i32, w: i32| {
                        CreateWindowExW(
                            0,
                            button.as_ptr(),
                            wide(label).as_ptr(),
                            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_OWNERDRAW as u32,
                            scale(x),
                            scale(y),
                            scale(w),
                            scale(40),
                            window,
                            id as usize as _,
                            instance,
                            std::ptr::null(),
                        )
                    };
                    let pause = make_button(PAUSE_ID, "Pause sharing", 236, 314, 140);
                    // Offering a file to the helper is only there when file transfer was allowed.
                    let send_file = if desktop {
                        make_button(SEND_ID, "Send a file…", 28, 314, 196)
                    } else {
                        std::ptr::null_mut()
                    };
                    let stop = make_button(
                        STOP_ID,
                        if desktop {
                            "Stop sharing"
                        } else {
                            "Stop video test"
                        },
                        388,
                        314,
                        104,
                    );
                    // Ends only the live file and recording permissions; the session and its screen stay as they are.
                    let revoke = make_button(
                        REVOKE_ID,
                        "Turn off file and recording access",
                        28,
                        364,
                        300,
                    );
                    // Mute stops sound toward the viewer only; video and control continue. Shown on the desktop sharing window.
                    let mute = if desktop {
                        make_button(
                            MUTE_ID,
                            if crate::audio::muted() {
                                "Unmute sound"
                            } else {
                                "Mute sound"
                            },
                            340,
                            364,
                            152,
                        )
                    } else {
                        std::ptr::null_mut()
                    };
                    // The request for more access appears inside this card, below Stop, only while one is pending.
                    let prompt_title = make_text(
                        PROMPT_TITLE_ID,
                        "The viewer is asking for more access",
                        44,
                        496,
                        432,
                        22,
                        0,
                    );
                    let prompt_detail = make_text(PROMPT_DETAIL_ID, "", 44, 522, 432, 44, 0);
                    let prompt_decline = make_button(PROMPT_DECLINE_ID, "Decline", 248, 574, 104);
                    let prompt_allow = make_button(PROMPT_ALLOW_ID, "Allow once", 364, 574, 128);
                    for hidden in [prompt_title, prompt_detail, prompt_decline, prompt_allow] {
                        if !hidden.is_null() {
                            ShowWindow(hidden, SW_HIDE);
                        }
                    }
                    let controls = [
                        prompt_title,
                        prompt_detail,
                        prompt_decline,
                        prompt_allow,
                        heading,
                        status_control,
                        requester,
                        session_text,
                        tag,
                        panel,
                        row_view,
                        row_input,
                        row_limits,
                        footer,
                        pause,
                        stop,
                        revoke,
                    ];
                    if controls.iter().any(|handle| handle.is_null())
                        || (desktop && (send_file.is_null() || mute.is_null()))
                        || SetTimer(window, 1, 100, None) == 0
                    {
                        DestroyWindow(window);
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err(io::Error::last_os_error().into());
                    }
                    if desktop && !extras.files {
                        ShowWindow(send_file, SW_HIDE);
                    }
                    if Permissions::read(&state.extras) == Permissions::default() {
                        ShowWindow(revoke, SW_HIDE);
                    }
                    if !state.live() {
                        DestroyWindow(window);
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err("View expired, stopped or input desktop unavailable".into());
                    }
                    let px = move |value: i32| (value as f32 * factor).round() as i32;
                    let heading_font = ui::gdi_font(px(21), 600);
                    let strong_font = ui::gdi_font(px(15), 600);
                    let long_font = if long_name {
                        ui::gdi_font(px(13), 600)
                    } else {
                        strong_font
                    };
                    let body_font = ui::gdi_font(px(13), 400);
                    let small_font = ui::gdi_font(px(12), 400);
                    let tag_font = ui::gdi_font(px(11), 600);
                    for (handle, font) in [
                        (heading, heading_font),
                        (prompt_title, strong_font),
                        (prompt_detail, body_font),
                        (requester, long_font),
                        (panel, strong_font),
                        (status_control, body_font),
                        (row_view, body_font),
                        (row_input, body_font),
                        (row_limits, body_font),
                        (session_text, small_font),
                        (footer, small_font),
                        (tag, tag_font),
                    ] {
                        SendMessageW(handle, WM_SETFONT, font as usize, 1);
                    }
                    ShowWindow(window, SW_SHOW);
                    if SetForegroundWindow(window) == 0 {
                        let attention = FLASHWINFO {
                            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                            hwnd: window,
                            dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
                            uCount: 3,
                            dwTimeout: 0,
                        };
                        FlashWindowEx(&attention);
                    }
                    SetFocus(stop);
                    state.card.open.store(true, Ordering::Release);
                    if let Ok(mut current) = CARD.lock() {
                        *current = Some(state.card.clone());
                    }
                    let _ = ready.send(Ok(()));
                    let mut message = MSG::default();
                    loop {
                        let status = GetMessageW(&mut message, std::ptr::null_mut(), 0, 0);
                        if status <= 0 {
                            break;
                        }
                        dispatch(window, &message);
                    }
                    state.active.store(false, Ordering::Release);
                    state.card.open.store(false, Ordering::Release);
                    if let Ok(mut current) = CARD.lock() {
                        if current
                            .as_ref()
                            .is_some_and(|card| Arc::ptr_eq(card, &state.card))
                        {
                            *current = None;
                        }
                    }
                    if IsWindow(window) != 0 {
                        DestroyWindow(window);
                    }
                    for font in [heading_font, strong_font, body_font, small_font, tag_font] {
                        ui::delete_font(font);
                    }
                    if long_name {
                        ui::delete_font(long_font);
                    }
                    UnregisterClassW(class.as_ptr(), instance);
                    Ok(())
                }
            })();
            if let Err(error) = result {
                state.active.store(false, Ordering::Release);
                let _ = ready.send(Err(error.to_string()));
            }
        });
        match received.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(Self {
                card,
                active,
                thread: Some(thread),
            }),
            _ => {
                active.store(false, Ordering::Release);
                Err("Visible Stop control unavailable; sharing refused".into())
            }
        }
    }
}
impl Drop for Indicator {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
        self.card.open.store(false, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use windows_sys::Win32::{
        Foundation::{HMODULE, HWND},
        System::{
            StationsAndDesktops::{
                CloseDesktop, CreateDesktopW, GetThreadDesktop, SetThreadDesktop,
                DESKTOP_CREATEWINDOW, DESKTOP_READOBJECTS, DESKTOP_WRITEOBJECTS,
            },
            Threading::GetCurrentThreadId,
        },
        UI::Input::KeyboardAndMouse::{VK_ESCAPE, VK_RETURN},
    };

    struct HiddenWindow {
        window: HWND,
        state: Box<WindowState>,
    }
    impl Drop for HiddenWindow {
        fn drop(&mut self) {
            unsafe {
                if IsWindow(self.window) != 0 {
                    DestroyWindow(self.window);
                }
                let mut message = MSG::default();
                PeekMessageW(
                    &mut message,
                    std::ptr::null_mut(),
                    WM_QUIT,
                    WM_QUIT,
                    PM_REMOVE,
                );
            }
        }
    }
    unsafe fn hidden_window(
        instance: HMODULE,
        class: &[u16],
        desktop: bool,
        deadline: Option<Instant>,
    ) -> HiddenWindow {
        let state = Box::new(WindowState::new(
            Arc::new(AtomicBool::new(true)),
            Arc::new(AtomicBool::new(false)),
            desktop,
            Arc::new(AtomicBool::new(false)),
            deadline,
        ));
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
            std::ptr::from_ref(&*state).cast(),
        );
        assert!(!window.is_null());
        let fixture = HiddenWindow { window, state };
        let button_class = wide("BUTTON");
        let control = CreateWindowExW(
            0,
            button_class.as_ptr(),
            class.as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON as u32,
            0,
            0,
            1,
            1,
            window,
            STOP_ID as usize as _,
            instance,
            std::ptr::null(),
        );
        assert!(!control.is_null());
        fixture
    }

    #[test]
    fn connecting_window_stops_on_desktop_loss_expiry_and_keyboard() {
        // These windows live on a newly created noninput desktop. Never switch
        // the visible desktop, approve consent, inject OS input or start capture.
        thread::spawn(|| unsafe {
            let original = GetThreadDesktop(GetCurrentThreadId());
            let name = wide(&format!("BeaconStopGuardTest-{}", GetCurrentThreadId()));
            let desktop = CreateDesktopW(
                name.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                DESKTOP_CREATEWINDOW | DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS,
                std::ptr::null(),
            );
            assert!(!desktop.is_null());
            assert_ne!(SetThreadDesktop(desktop), 0);
            let instance = GetModuleHandleW(std::ptr::null());
            let definition = WNDCLASSW {
                lpfnWndProc: Some(procedure),
                hInstance: instance,
                lpszClassName: name.as_ptr(),
                ..Default::default()
            };
            assert_ne!(RegisterClassW(&definition), 0);
            let result = std::panic::catch_unwind(|| {
                assert!(!crate::capture::desktop_receives_input());
                for (capture, deadline) in [
                    (true, Instant::now() + Duration::from_secs(5)),
                    (false, Instant::now()),
                ] {
                    let fixture = hidden_window(instance, &name, capture, Some(deadline));
                    dispatch(
                        fixture.window,
                        &MSG {
                            hwnd: fixture.window,
                            message: WM_TIMER,
                            wParam: 1,
                            ..Default::default()
                        },
                    );
                    assert!(!fixture.state.active.load(Ordering::Acquire));
                    assert_eq!(IsWindow(fixture.window), 0);
                }
                for key in [VK_RETURN, VK_ESCAPE] {
                    let fixture = hidden_window(
                        instance,
                        &name,
                        false,
                        Some(Instant::now() + Duration::from_secs(5)),
                    );
                    dispatch(
                        fixture.window,
                        &MSG {
                            hwnd: GetDlgItem(fixture.window, STOP_ID),
                            message: WM_KEYDOWN,
                            wParam: key as usize,
                            ..Default::default()
                        },
                    );
                    assert!(!fixture.state.active.load(Ordering::Acquire));
                    assert_eq!(IsWindow(fixture.window), 0);
                }
            });
            assert_ne!(UnregisterClassW(name.as_ptr(), instance), 0);
            assert_ne!(SetThreadDesktop(original), 0);
            assert_ne!(CloseDesktop(desktop), 0);
            result.unwrap();
        })
        .join()
        .unwrap();
    }

    /// A request for more access is answered inside the card: Decline is the default, Escape declines without
    /// stopping the session, Allow once approves only a pending request, and a cancelled request declines.
    #[test]
    fn inline_request_declines_by_default_and_never_stops_sharing() {
        thread::spawn(|| unsafe {
            let original = GetThreadDesktop(GetCurrentThreadId());
            let name = wide(&format!("BeaconCardTest-{}", GetCurrentThreadId()));
            let desktop = CreateDesktopW(
                name.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                DESKTOP_CREATEWINDOW | DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS,
                std::ptr::null(),
            );
            assert!(!desktop.is_null());
            assert_ne!(SetThreadDesktop(desktop), 0);
            let instance = GetModuleHandleW(std::ptr::null());
            let definition = WNDCLASSW {
                lpfnWndProc: Some(procedure),
                hInstance: instance,
                lpszClassName: name.as_ptr(),
                ..Default::default()
            };
            assert_ne!(RegisterClassW(&definition), 0);
            let result = std::panic::catch_unwind(|| {
                let fixture = hidden_window(
                    instance,
                    &name,
                    false,
                    Some(Instant::now() + Duration::from_secs(30)),
                );
                let window = fixture.window;
                let make = |class: &str, id: i32| {
                    let class = wide(class);
                    CreateWindowExW(
                        0,
                        class.as_ptr(),
                        wide("x").as_ptr(),
                        WS_CHILD | WS_TABSTOP | BS_OWNERDRAW as u32,
                        0,
                        0,
                        1,
                        1,
                        window,
                        id as usize as _,
                        instance,
                        std::ptr::null(),
                    )
                };
                for (class, id) in [
                    ("STATIC", PROMPT_TITLE_ID),
                    ("STATIC", PROMPT_DETAIL_ID),
                    ("BUTTON", PROMPT_DECLINE_ID),
                    ("BUTTON", PROMPT_ALLOW_ID),
                ] {
                    assert!(!make(class, id).is_null());
                }
                let card = fixture.state.card.clone();
                card.open.store(true, Ordering::Release);
                let pump = |what: &dyn Fn() -> bool| {
                    let end = Instant::now() + Duration::from_secs(5);
                    while !what() && Instant::now() < end {
                        dispatch(
                            window,
                            &MSG {
                                hwnd: window,
                                message: WM_TIMER,
                                wParam: 1,
                                ..Default::default()
                            },
                        );
                        thread::sleep(Duration::from_millis(10));
                    }
                };
                let click = |id: i32| {
                    dispatch(
                        window,
                        &MSG {
                            hwnd: window,
                            message: WM_COMMAND,
                            wParam: id as usize | ((BN_CLICKED as usize) << 16),
                            ..Default::default()
                        },
                    );
                };
                let ask = |pending: Arc<AtomicBool>, seconds: u64| {
                    let card = card.clone();
                    thread::spawn(move || {
                        card.ask(
                            "Allow mouse and keyboard for this connection",
                            &pending,
                            Instant::now() + Duration::from_secs(seconds),
                        )
                    })
                };
                let shown = || fixture.state.prompt_shown.load(Ordering::Acquire);
                let sharing =
                    || fixture.state.active.load(Ordering::Acquire) && IsWindow(window) != 0;
                // The default answer is Decline.
                let pending = Arc::new(AtomicBool::new(true));
                let answer = ask(pending.clone(), 20);
                pump(&shown);
                assert!(shown());
                assert_eq!(
                    dispatch_default(window),
                    PROMPT_DECLINE_ID as usize,
                    "Decline is the default while asking"
                );
                click(PROMPT_DECLINE_ID);
                assert!(!answer.join().unwrap());
                pump(&|| !shown());
                assert!(sharing());
                // Escape declines and never stops sharing.
                let answer = ask(pending.clone(), 20);
                pump(&shown);
                click(IDCANCEL);
                assert!(!answer.join().unwrap());
                assert!(sharing(), "Escape on a request must not stop sharing");
                // Only the explicit Allow once approves.
                let answer = ask(pending.clone(), 20);
                pump(&shown);
                click(PROMPT_ALLOW_ID);
                assert!(answer.join().unwrap());
                pump(&|| !shown());
                // A request cancelled by the caller declines and clears the card.
                let cancelled = Arc::new(AtomicBool::new(true));
                let answer = ask(cancelled.clone(), 20);
                pump(&shown);
                cancelled.store(false, Ordering::Release);
                assert!(!answer.join().unwrap());
                pump(&|| !shown());
                // An approval click after cancellation grants nothing.
                click(PROMPT_ALLOW_ID);
                // An expired request declines.
                let answer = ask(pending.clone(), 0);
                assert!(!answer.join().unwrap());
                assert!(sharing());
                // Stop still stops sharing when no request is open.
                click(STOP_ID);
                assert!(!fixture.state.active.load(Ordering::Acquire));
            });
            assert_ne!(UnregisterClassW(name.as_ptr(), instance), 0);
            assert_ne!(SetThreadDesktop(original), 0);
            assert_ne!(CloseDesktop(desktop), 0);
            result.unwrap();
        })
        .join()
        .unwrap();
    }
    unsafe fn dispatch_default(window: HWND) -> usize {
        (SendMessageW(window, DM_GETDEFID, 0, 0) as usize) & 0xffff
    }
}
