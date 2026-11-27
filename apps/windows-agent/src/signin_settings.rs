//! Owner-visible sign-in setup. Actions reuse the protected endpoint lifecycle;
//! opening/refreshing this window never installs, starts or enables anything.
use crate::native_ui as ui;
use crate::{signin_endpoint, HostError};
use std::{
    io,
    ptr::{null, null_mut},
    thread::{self, JoinHandle},
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::{
        CreateFontW, CreateSolidBrush, DeleteObject, DrawTextW, FillRect, GetDC, ReleaseDC,
        SelectObject, SetBkColor, SetTextColor, DEFAULT_CHARSET, DT_CALCRECT, DT_NOPREFIX,
        DT_WORDBREAK, HBRUSH, HFONT,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Controls::{SetScrollInfo, DRAWITEMSTRUCT, ODS_DISABLED, ODS_FOCUS, ODS_SELECTED},
        HiDpi::{
            GetDpiForSystem, GetDpiForWindow, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        },
        Input::KeyboardAndMouse::{
            EnableWindow, GetFocus, IsWindowEnabled, SetActiveWindow, SetFocus,
        },
        WindowsAndMessaging::*,
    },
};

const SETUP: usize = 101;
const DISABLE: usize = 102;
const REMOVE: usize = 103;
const REFRESH: usize = 104;
const CLOSE: usize = 105;
const LABEL: usize = 106;
const DETAIL: usize = 107;
const OUTCOME: usize = 108;
const REPAIR: usize = 109;
/// Posted to the parent when the page is embedded in another window and the person chooses Back.
pub const BACK: u32 = WM_APP + 7;

fn clicked_command(value: WPARAM) -> Option<usize> {
    ((value >> 16) == BN_CLICKED as usize).then_some(value & 0xffff)
}

struct Font(HFONT);
struct Brush(HBRUSH);
impl Drop for Brush {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                DeleteObject(self.0);
            }
        }
    }
}
struct DpiContext(DPI_AWARENESS_CONTEXT);
impl Drop for DpiContext {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                SetThreadDpiAwarenessContext(self.0);
            }
        }
    }
}
impl Drop for Font {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                DeleteObject(self.0);
            }
        }
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

struct Snapshot {
    paired: bool,
    owner_control: bool,
    endpoint: Result<signin_endpoint::Status, String>,
}
impl Snapshot {
    fn read() -> Self {
        let paired = crate::is_paired();
        let access = crate::local_access();
        Self {
            paired,
            owner_control: access.trusted && access.allow_control,
            endpoint: signin_endpoint::status().map_err(|error| error.to_string()),
        }
    }
    fn presentation(&self) -> (String, &'static str, bool) {
        if !self.paired {
            return (
                "Pair this computer before setting up sign-in access.".into(),
                "Set up sign-in access…",
                false,
            );
        }
        let setup = self.owner_control;
        match &self.endpoint {
            Err(error) => (
                format!("Installation could not be verified.\r\n{error}"),
                "Enable sign-in access…",
                setup,
            ),
            Ok(status) if !status.installed => (
                "Sign-in access is not installed.".into(),
                "Set up sign-in access…",
                setup,
            ),
            Ok(status) => {
                let state = if status.locally_disabled {
                    "Disabled on this computer."
                } else if !status.running {
                    "Sign-in service is stopped."
                } else if !status.automatic {
                    "Sign-in service is not set to start at boot."
                } else if !status.media_supported {
                    "Service prepared. Sign-in control is unavailable in this development build."
                } else if !status.media_ready {
                    "Service running. Check your workspace for current sign-in connection availability."
                } else {
                    "Sign-in endpoint ready. Windows authentication is still required."
                };
                let mut message = state.to_string();
                match status.service_matches_build {
                    Some(false) => message.push_str("\r\nService build differs from this host. Repair service to use this build; Disable stays in effect."),
                    None => message.push_str("\r\nService build could not be compared. Check the installed host package."),
                    Some(true) => (),
                }
                if !status.recovery_configured {
                    message.push_str("\r\nCrash recovery settings need repair.");
                }
                (message, "Enable sign-in access…", setup)
            }
        }
    }
}
#[derive(Clone, Copy)]
enum Action {
    Refresh,
    Setup,
    Repair,
    Disable,
    Remove,
}
impl Action {
    fn perform(self) -> Result<(), HostError> {
        match self {
            Self::Refresh => Ok(()),
            Self::Setup => signin_endpoint::setup(),
            Self::Repair => signin_endpoint::repair(),
            Self::Disable => signin_endpoint::disable(),
            Self::Remove => signin_endpoint::remove(),
        }
    }
    fn progress(self) -> &'static str {
        match self {
            Self::Refresh => "Checking this computer…",
            Self::Repair => {
                "Repairing the service. Approve Windows administrator setup to continue…"
            }
            Self::Setup => {
                "Preparing sign-in access. Approve the Windows administrator prompt to continue…"
            }
            Self::Disable => "Stopping sign-in access and confirming local Disable…",
            Self::Remove => {
                "Removing sign-in access. Approve the Windows administrator prompt to continue…"
            }
        }
    }
    fn success(self) -> &'static str {
        match self {
            Self::Refresh => "",
            Self::Setup => "Setup completed. See the current readiness above.",
            Self::Repair => "Service repaired. Existing access settings are preserved.",
            Self::Disable => "Sign-in access is disabled on this computer.",
            Self::Remove => "Sign-in service removed. Ordinary host pairing is preserved.",
        }
    }
}
type Job = JoinHandle<(Snapshot, Result<(), String>)>;
struct Ui {
    snapshot: Option<Snapshot>,
    job: Option<(Action, Job)>,
    scroll: i32,
    scale: f32,
    fonts: Option<(Font, Font)>,
    palette: ui::Palette,
    background: Brush,
    content_height: i32,
    fit_pending: bool,
    focus_after_job: HWND,
    /// Shown as a page inside the host window instead of as its own window.
    embedded: bool,
}
impl Ui {
    unsafe fn apply_fonts(&mut self, window: HWND) {
        let create = |size, weight| {
            Font(unsafe {
                CreateFontW(
                    -((size as f32 * self.scale).round() as i32),
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
                    wide("Segoe UI").as_ptr(),
                )
            })
        };
        let fonts = (create(14, 400), create(16, 600));
        if fonts.0 .0.is_null() || fonts.1 .0.is_null() {
            return;
        }
        for id in [
            LABEL, DETAIL, SETUP, REPAIR, DISABLE, REMOVE, OUTCOME, REFRESH, CLOSE,
        ] {
            unsafe {
                SendMessageW(
                    GetDlgItem(window, id as i32),
                    WM_SETFONT,
                    if id == LABEL { fonts.1 .0 } else { fonts.0 .0 } as usize,
                    1,
                );
            }
        }
        self.fonts = Some(fonts);
    }
    unsafe fn text(window: HWND, id: usize, value: &str) {
        unsafe {
            SetWindowTextW(GetDlgItem(window, id as i32), wide(value).as_ptr());
        }
    }
    unsafe fn update(&self, window: HWND) {
        let busy = self.job.is_some();
        let (label, setup, can_setup) = self.snapshot.as_ref().map_or(
            (
                "Checking installation…".into(),
                "Set up sign-in access…",
                false,
            ),
            Snapshot::presentation,
        );
        unsafe {
            Self::text(window, LABEL, &label);
            Self::text(window, SETUP, setup);
            Self::text(
                window,
                REFRESH,
                if self
                    .job
                    .as_ref()
                    .is_some_and(|(action, _)| matches!(action, Action::Refresh))
                {
                    "Checking…"
                } else {
                    "Refresh status"
                },
            );
            EnableWindow(
                GetDlgItem(window, SETUP as i32),
                i32::from(!busy && can_setup),
            );
            let paired = self.snapshot.as_ref().is_some_and(|state| {
                state.paired
                    && state
                        .endpoint
                        .as_ref()
                        .map_or(true, |endpoint| endpoint.installed)
            });
            ShowWindow(
                GetDlgItem(window, SETUP as i32),
                if self.snapshot.as_ref().is_some_and(|state| state.paired) {
                    SW_SHOW
                } else {
                    SW_HIDE
                },
            );
            for id in [REPAIR, DISABLE, REMOVE] {
                ShowWindow(
                    GetDlgItem(window, id as i32),
                    if paired { SW_SHOW } else { SW_HIDE },
                );
                EnableWindow(GetDlgItem(window, id as i32), i32::from(!busy && paired));
            }
            EnableWindow(GetDlgItem(window, REFRESH as i32), i32::from(!busy));
            EnableWindow(GetDlgItem(window, CLOSE as i32), i32::from(!busy));
            ShowWindow(
                GetDlgItem(window, OUTCOME as i32),
                if GetWindowTextLengthW(GetDlgItem(window, OUTCOME as i32)) > 0 {
                    SW_SHOW
                } else {
                    SW_HIDE
                },
            );
            Self::text(
                window,
                DETAIL,
                if self.snapshot.as_ref().is_some_and(|state| !state.paired) {
                    "Open Beacon Remote Host to pair this computer. Then choose the access your account needs."
                } else if self
                    .snapshot
                    .as_ref()
                    .is_some_and(|state| !state.owner_control)
                {
                    "Allow owner control in the host before enabling Windows sign-in access."
                } else {
                    "Windows sign-in uses a separate service. Enabling access requires administrator approval; Windows still checks your credentials."
                },
            );
        }
    }
    unsafe fn start(&mut self, window: HWND, action: Action) {
        if self.job.is_some() {
            return;
        }
        unsafe {
            let focused = GetFocus();
            self.focus_after_job = if GetParent(focused) == window {
                focused
            } else {
                null_mut()
            };
            Self::text(
                window,
                OUTCOME,
                if matches!(action, Action::Refresh) {
                    ""
                } else {
                    action.progress()
                },
            );
        }
        self.job = Some((
            action,
            thread::spawn(move || {
                let outcome = action.perform().map_err(|error| error.to_string());
                (Snapshot::read(), outcome)
            }),
        ));
        unsafe {
            self.update(window);
            self.layout(window);
        }
    }
    unsafe fn layout(&mut self, window: HWND) {
        let mut rect = RECT::default();
        unsafe {
            GetClientRect(window, &mut rect);
        }
        let unit = |value: i32| (value as f32 * self.scale).round() as i32;
        let text_height = |id, minimum| unsafe {
            let control = GetDlgItem(window, id);
            if control.is_null() {
                return unit(minimum);
            }
            let mut text = vec![0u16; GetWindowTextLengthW(control).max(0) as usize + 1];
            let length = GetWindowTextW(control, text.as_mut_ptr(), text.len() as i32);
            let dc = GetDC(control);
            if dc.is_null() {
                return unit(minimum);
            }
            let previous = SelectObject(dc, SendMessageW(control, WM_GETFONT, 0, 0) as _);
            let mut bounds = RECT {
                right: (rect.right - unit(40)).max(1),
                ..Default::default()
            };
            DrawTextW(
                dc,
                text.as_ptr(),
                length,
                &mut bounds,
                DT_CALCRECT | DT_WORDBREAK | DT_NOPREFIX,
            );
            SelectObject(dc, previous);
            ReleaseDC(control, dc);
            bounds.bottom.max(unit(minimum))
        };
        let mut rows = Vec::new();
        let mut y = unit(20);
        for (id, height) in [
            (LABEL, text_height(LABEL as i32, 24)),
            (DETAIL, text_height(DETAIL as i32, 24)),
            (SETUP, unit(44)),
            (REPAIR, unit(44)),
            (DISABLE, unit(44)),
            (REMOVE, unit(44)),
            (OUTCOME, text_height(OUTCOME as i32, 24)),
        ] {
            if matches!(id, SETUP | REPAIR | DISABLE | REMOVE)
                && unsafe { IsWindowVisible(GetDlgItem(window, id as i32)) } == 0
            {
                continue;
            }
            if id == OUTCOME && unsafe { GetWindowTextLengthW(GetDlgItem(window, id as i32)) } == 0
            {
                continue;
            }
            rows.push((id, y, height));
            y += height + unit(12);
        }
        rows.push((REFRESH, y, unit(44)));
        rows.push((CLOSE, y, unit(44)));
        let content = y + unit(64);
        self.content_height = content;
        let mut scroll = SCROLLINFO {
            cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
            fMask: SIF_RANGE | SIF_PAGE | SIF_POS,
            nMin: 0,
            nMax: content - 1,
            nPage: rect.bottom.max(0) as u32,
            nPos: self.scroll,
            ..Default::default()
        };
        unsafe {
            SetScrollInfo(window, SB_VERT, &scroll, 1);
            GetScrollInfo(window, SB_VERT, &mut scroll);
        }
        self.scroll = scroll.nPos;
        for (id, y, height) in rows {
            let (x, width) = match id {
                REFRESH => (unit(20), (rect.right - unit(48)) / 2),
                CLOSE => (rect.right / 2 + unit(4), (rect.right - unit(48)) / 2),
                _ => (unit(20), rect.right - unit(40)),
            };
            unsafe {
                MoveWindow(
                    GetDlgItem(window, id as i32),
                    x,
                    y - self.scroll,
                    width.max(1),
                    height,
                    1,
                );
            }
        }
    }
    unsafe fn fit(&mut self, window: HWND) {
        if !self.fit_pending {
            return;
        }
        self.fit_pending = false;
        let mut client = RECT::default();
        let mut outer = RECT::default();
        let mut work = RECT::default();
        unsafe {
            GetClientRect(window, &mut client);
            GetWindowRect(window, &mut outer);
            SystemParametersInfoW(SPI_GETWORKAREA, 0, (&mut work as *mut RECT).cast(), 0);
        }
        let height = (self.content_height + outer.bottom - outer.top - client.bottom)
            .min(work.bottom - work.top - 40)
            .max((200.0 * self.scale).round() as i32);
        unsafe {
            SetWindowPos(
                window,
                null_mut(),
                0,
                0,
                outer.right - outer.left,
                height,
                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
    unsafe fn reveal(&mut self, window: HWND, control: HWND) {
        let mut rect = RECT::default();
        unsafe {
            GetWindowRect(control, &mut rect);
        }
        let mut points = [
            POINT {
                x: rect.left,
                y: rect.top,
            },
            POINT {
                x: rect.right,
                y: rect.bottom,
            },
        ];
        unsafe {
            windows_sys::Win32::Graphics::Gdi::MapWindowPoints(
                null_mut(),
                window,
                points.as_mut_ptr(),
                2,
            );
            GetClientRect(window, &mut rect);
        }
        if points[0].y < 0 {
            self.scroll += points[0].y;
        } else if points[1].y > rect.bottom {
            self.scroll += points[1].y - rect.bottom;
        }
        unsafe {
            self.layout(window);
        }
    }
}
unsafe extern "system" fn procedure(window: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if message == WM_NCCREATE {
        let create = unsafe { &*(l as *const CREATESTRUCTW) };
        unsafe {
            SetWindowLongPtrW(window, GWLP_USERDATA, create.lpCreateParams as isize);
        }
    }
    let pointer = unsafe { GetWindowLongPtrW(window, GWLP_USERDATA) as *mut Ui };
    if pointer.is_null() {
        return unsafe { DefWindowProcW(window, message, w, l) };
    }
    let state = unsafe { &mut *pointer };
    match message {
        WM_SETFOCUS if state.job.is_none() => unsafe {
            SetFocus(GetDlgItem(window, CLOSE as i32));
        },
        WM_ERASEBKGND => {
            let mut rect = RECT::default();
            unsafe {
                GetClientRect(window, &mut rect);
                FillRect(w as _, &rect, state.background.0);
            }
            return 1;
        }
        WM_CTLCOLORSTATIC => {
            unsafe {
                SetTextColor(
                    w as _,
                    ui::colorref(if GetDlgCtrlID(l as HWND) == LABEL as i32 {
                        state.palette.strong
                    } else {
                        state.palette.muted
                    }),
                );
                SetBkColor(w as _, ui::colorref(state.palette.window));
            }
            return state.background.0 as isize;
        }
        WM_DRAWITEM => {
            let item = unsafe { &*(l as *const DRAWITEMSTRUCT) };
            let mut label = [0u16; 160];
            let length =
                unsafe { GetWindowTextW(item.hwndItem, label.as_mut_ptr(), label.len() as i32) }
                    .max(0) as usize;
            unsafe {
                FillRect(item.hDC, &item.rcItem, state.background.0);
                if let Some(canvas) = ui::Canvas::new(item.hDC, state.scale) {
                    ui::button(
                        &canvas,
                        &state.palette,
                        (
                            (item.rcItem.right - item.rcItem.left) as f32 / state.scale,
                            (item.rcItem.bottom - item.rcItem.top) as f32 / state.scale,
                        ),
                        &String::from_utf16_lossy(&label[..length]),
                        if item.CtlID == SETUP as u32 {
                            ui::Role::Primary
                        } else if item.CtlID == DISABLE as u32 {
                            ui::Role::Danger
                        } else {
                            ui::Role::Secondary
                        },
                        ui::State {
                            hot: false,
                            pressed: item.itemState & ODS_SELECTED != 0,
                            focused: item.itemState & ODS_FOCUS != 0,
                            disabled: item.itemState & ODS_DISABLED != 0,
                        },
                    );
                }
            }
            return 1;
        }
        WM_SETTINGCHANGE | WM_THEMECHANGED => {
            state.palette = ui::palette();
            state.background =
                Brush(unsafe { CreateSolidBrush(ui::colorref(state.palette.window)) });
            unsafe {
                ui::style_title_bar(window as isize, ui::dark_mode());
                windows_sys::Win32::Graphics::Gdi::InvalidateRect(window, null(), 1);
            }
        }
        WM_ENTERSIZEMOVE => {
            state.fit_pending = false;
        }
        WM_GETMINMAXINFO => {
            let bounds = unsafe { &mut *(l as *mut MINMAXINFO) };
            bounds.ptMinTrackSize.x = (260.0 * state.scale).round() as i32;
            bounds.ptMinTrackSize.y = (200.0 * state.scale).round() as i32;
        }
        WM_DPICHANGED => {
            state.scale = (w as u16) as f32 / 96.0;
            let bounds = unsafe { &*(l as *const RECT) };
            unsafe {
                state.apply_fonts(window);
                MoveWindow(
                    window,
                    bounds.left,
                    bounds.top,
                    bounds.right - bounds.left,
                    bounds.bottom - bounds.top,
                    1,
                );
                state.layout(window);
            }
        }
        WM_SIZE => unsafe {
            state.layout(window);
        },
        WM_VSCROLL => {
            let code = w as u16 as i32;
            let mut info = SCROLLINFO {
                cbSize: std::mem::size_of::<SCROLLINFO>() as u32,
                fMask: SIF_ALL,
                ..Default::default()
            };
            unsafe {
                GetScrollInfo(window, SB_VERT, &mut info);
            }
            state.scroll += match code {
                SB_LINEUP => -24,
                SB_LINEDOWN => 24,
                SB_PAGEUP => -(info.nPage as i32),
                SB_PAGEDOWN => info.nPage as i32,
                SB_THUMBTRACK | SB_THUMBPOSITION => info.nTrackPos - state.scroll,
                SB_TOP => -state.scroll,
                SB_BOTTOM => info.nMax - state.scroll,
                _ => 0,
            };
            unsafe {
                state.layout(window);
            }
        }
        WM_MOUSEWHEEL => {
            state.scroll -= ((w >> 16) as u16 as i16 as i32) / 3;
            unsafe {
                state.layout(window);
            }
        }
        WM_COMMAND => {
            let id = w & 0xffff;
            if w >> 16 == BN_SETFOCUS as usize {
                unsafe {
                    state.reveal(window, l as HWND);
                }
                return 0;
            }
            // BS_NOTIFY also reports lost focus, highlight and disable events.
            // None of those may enable/disable/remove a service or close UI.
            if clicked_command(w).is_none() {
                return 0;
            }
            if state.job.is_some() {
                return 0;
            }
            match id {
                SETUP => {
                    if !state.snapshot.as_ref().is_some_and(|s| s.presentation().2) {
                        return 0;
                    }
                    let confirmed = unsafe {
                        MessageBoxW(window, wide(if cfg!(feature = "signin-media") {
                            "Allow your account to control this computer at Windows sign-in?\r\n\r\nThis installs or repairs a separate service with Windows administrator approval. Windows authentication remains required."
                        } else {
                            "Allow your account to control this computer at Windows sign-in?\r\n\r\nThis installs or repairs a separate service with Windows administrator approval. Windows authentication remains required. Sign-in media remains unavailable in this development build."
                        }).as_ptr(), wide("Windows sign-in access").as_ptr(), MB_OKCANCEL | MB_ICONINFORMATION | MB_DEFBUTTON2)
                    };
                    if confirmed == IDOK {
                        unsafe {
                            state.start(window, Action::Setup);
                        }
                    }
                }
                REPAIR => {
                    let confirmed = unsafe {
                        MessageBoxW(window, wide("Repair the sign-in service?\r\n\r\nCurrent Disable and backend access settings are preserved. Windows administrator approval is required.").as_ptr(), wide("Repair sign-in service").as_ptr(), MB_OKCANCEL | MB_ICONINFORMATION | MB_DEFBUTTON2)
                    };
                    if confirmed == IDOK {
                        unsafe {
                            state.start(window, Action::Repair);
                        }
                    }
                }
                DISABLE => unsafe {
                    state.start(window, Action::Disable);
                },
                REMOVE => {
                    let confirmed = unsafe {
                        MessageBoxW(window, wide("Stop and remove the sign-in service? Ordinary host pairing is preserved. Windows administrator approval may be required.").as_ptr(), wide("Remove sign-in access").as_ptr(), MB_OKCANCEL | MB_ICONWARNING | MB_DEFBUTTON2)
                    };
                    if confirmed == IDOK {
                        unsafe {
                            state.start(window, Action::Remove);
                        }
                    }
                }
                REFRESH => unsafe {
                    state.start(window, Action::Refresh);
                },
                CLOSE | 2 => unsafe {
                    if state.embedded {
                        PostMessageW(GetParent(window), BACK, 0, 0);
                    } else {
                        DestroyWindow(window);
                    }
                },
                _ => (),
            }
        }
        WM_TIMER => {
            if state.job.as_ref().is_some_and(|(_, job)| job.is_finished()) {
                let (action, job) = state.job.take().unwrap();
                let outcome = match job.join() {
                    Ok((snapshot, result)) => {
                        state.snapshot = Some(snapshot);
                        result.map(|_| action.success().to_string())
                    }
                    Err(_) => Err(
                        "The operation did not finish. Refresh status before trying again.".into(),
                    ),
                };
                unsafe {
                    Ui::text(
                        window,
                        OUTCOME,
                        &outcome.unwrap_or_else(|error| format!("Not completed: {error}")),
                    );
                    state.update(window);
                    state.layout(window);
                    state.fit(window);
                    if GetForegroundWindow() == window
                        && (GetFocus().is_null() || GetFocus() == window)
                    {
                        let target = if !state.focus_after_job.is_null()
                            && IsWindowEnabled(state.focus_after_job) != 0
                            && IsWindowVisible(state.focus_after_job) != 0
                        {
                            state.focus_after_job
                        } else {
                            GetDlgItem(window, CLOSE as i32)
                        };
                        SetFocus(target);
                    }
                }
            }
        }
        WM_CLOSE if state.job.is_none() => unsafe {
            if state.embedded {
                PostMessageW(GetParent(window), BACK, 0, 0);
            } else {
                DestroyWindow(window);
            }
        },
        WM_CLOSE => (),
        WM_DESTROY => unsafe {
            KillTimer(window, 1);
        },
        WM_NCDESTROY if state.embedded => unsafe {
            // An embedded page owns its state on the heap; free it with the window.
            SetWindowLongPtrW(window, GWLP_USERDATA, 0);
            drop(Box::from_raw(pointer));
            return DefWindowProcW(window, message, w, l);
        },
        _ => return unsafe { DefWindowProcW(window, message, w, l) },
    }
    0
}

/// Opens the local settings dialog; the owner is disabled only for its lifetime.
/// No service action runs until its explicit button is used.
///
/// # Safety
/// `owner` must be null or a live window owned by the calling UI thread.
pub unsafe fn show(owner: HWND) -> Result<(), HostError> {
    unsafe {
        let _dpi_context = DpiContext(SetThreadDpiAwarenessContext(
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        ));
        let scale = GetDpiForSystem().max(96) as f32 / 96.0;
        let instance = GetModuleHandleW(null());
        let class = wide("BeaconRemoteSignInSettings");
        let registration = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hIcon: LoadIconW(instance, 1 as _),
            hbrBackground: null_mut(),
            ..Default::default()
        };
        if RegisterClassW(&registration) == 0 {
            return Err(io::Error::last_os_error().into());
        }
        let mut state = Ui {
            snapshot: None,
            job: None,
            scroll: 0,
            scale,
            fonts: None,
            palette: ui::palette(),
            background: Brush(CreateSolidBrush(ui::colorref(ui::palette().window))),
            content_height: 0,
            fit_pending: true,
            focus_after_job: null_mut(),
            embedded: false,
        };
        let mut work = RECT::default();
        SystemParametersInfoW(SPI_GETWORKAREA, 0, (&mut work as *mut RECT).cast(), 0);
        let window = CreateWindowExW(
            WS_EX_CONTROLPARENT,
            class.as_ptr(),
            wide("Windows sign-in access — Beacon Remote").as_ptr(),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_VSCROLL,
            work.left + 20,
            work.top + 20,
            ((470.0 * scale).round() as i32)
                .min(work.right - work.left - 40)
                .max(250),
            ((600.0 * scale).round() as i32)
                .min(work.bottom - work.top - 40)
                .max(200),
            owner,
            null_mut(),
            instance,
            std::ptr::from_mut(&mut state).cast(),
        );
        if window.is_null() {
            UnregisterClassW(class.as_ptr(), instance);
            return Err(io::Error::last_os_error().into());
        }
        state.scale = GetDpiForWindow(window) as f32 / 96.0;
        ui::style_title_bar(window as isize, ui::dark_mode());
        let build = (|| -> Result<(), HostError> {
            for (id, label) in [
                (LABEL, "Checking installation…"),
                (DETAIL, ""),
                (SETUP, "Set up sign-in access…"),
                (REPAIR, "Repair service…"),
                (DISABLE, "Disable sign-in access"),
                (REMOVE, "Remove sign-in service…"),
                (OUTCOME, ""),
                (REFRESH, "Refresh status"),
                (CLOSE, "Close"),
            ] {
                let button = matches!(id, SETUP | REPAIR | DISABLE | REMOVE | REFRESH | CLOSE);
                let child = CreateWindowExW(
                    0,
                    wide(if button { "BUTTON" } else { "STATIC" }).as_ptr(),
                    wide(label).as_ptr(),
                    WS_CHILD
                        | WS_VISIBLE
                        | if button {
                            WS_TABSTOP | BS_NOTIFY as u32 | BS_OWNERDRAW as u32
                        } else {
                            windows_sys::Win32::System::SystemServices::SS_NOPREFIX
                        },
                    0,
                    0,
                    1,
                    1,
                    window,
                    id as _,
                    instance,
                    null(),
                );
                if child.is_null() {
                    return Err(io::Error::last_os_error().into());
                }
            }
            state.apply_fonts(window);
            state.layout(window);
            state.start(window, Action::Refresh);
            if SetTimer(window, 1, 100, None) == 0 {
                return Err(io::Error::last_os_error().into());
            }
            Ok(())
        })();
        if let Err(error) = build {
            DestroyWindow(window);
            UnregisterClassW(class.as_ptr(), instance);
            return Err(error);
        }
        let owner_enabled = !owner.is_null()
            && windows_sys::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled(owner) != 0;
        let previous_focus = GetFocus();
        if owner_enabled {
            EnableWindow(owner, 0);
        }
        ShowWindow(window, SW_SHOW);
        SetFocus(GetDlgItem(window, CLOSE as i32));
        let mut message = MSG::default();
        while IsWindow(window) != 0 {
            let result = GetMessageW(&mut message, null_mut(), 0, 0);
            if result <= 0 {
                if result == 0 {
                    PostQuitMessage(message.wParam as i32);
                }
                break;
            }
            if message.message == WM_KEYDOWN && message.wParam == 27 && state.job.is_none() {
                DestroyWindow(window);
            } else if IsDialogMessageW(window, &message) == 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        if IsWindow(window) != 0 {
            DestroyWindow(window);
        }
        if owner_enabled && IsWindow(owner) != 0 {
            EnableWindow(owner, 1);
            SetActiveWindow(owner);
            if IsWindow(previous_focus) != 0 {
                SetFocus(previous_focus);
            }
        }
        UnregisterClassW(class.as_ptr(), instance);
        Ok(())
    }
}

/// Creates the sign-in page as a child of `parent`, filling `area`. The page runs on the parent's message loop and
/// posts [`BACK`] to the parent when the person chooses Back. No service action runs until its explicit button is used.
///
/// # Safety
/// `parent` must be a live window owned by the calling UI thread.
pub unsafe fn embed(parent: HWND, area: RECT, scale: f32) -> Result<HWND, HostError> {
    unsafe {
        let instance = GetModuleHandleW(null());
        let class = wide("BeaconRemoteSignInSettings");
        let registration = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: null_mut(),
            ..Default::default()
        };
        // Registered once for the life of the process; a second page reuses it.
        if RegisterClassW(&registration) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS {
            return Err(io::Error::last_os_error().into());
        }
        let state = Box::into_raw(Box::new(Ui {
            snapshot: None,
            job: None,
            scroll: 0,
            scale,
            fonts: None,
            palette: ui::palette(),
            background: Brush(CreateSolidBrush(ui::colorref(ui::palette().window))),
            content_height: 0,
            fit_pending: false,
            focus_after_job: null_mut(),
            embedded: true,
        }));
        let window = CreateWindowExW(
            WS_EX_CONTROLPARENT,
            class.as_ptr(),
            wide("Windows sign-in access").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_VSCROLL | WS_CLIPCHILDREN,
            area.left,
            area.top,
            area.right - area.left,
            area.bottom - area.top,
            parent,
            null_mut(),
            instance,
            state.cast(),
        );
        if window.is_null() {
            drop(Box::from_raw(state));
            return Err(io::Error::last_os_error().into());
        }
        let ui = &mut *state;
        for (id, label) in [
            (LABEL, "Checking installation…"),
            (DETAIL, ""),
            (SETUP, "Set up sign-in access…"),
            (REPAIR, "Repair service…"),
            (DISABLE, "Disable sign-in access"),
            (REMOVE, "Remove sign-in service…"),
            (OUTCOME, ""),
            (REFRESH, "Refresh status"),
            (CLOSE, "Back"),
        ] {
            let button = matches!(id, SETUP | REPAIR | DISABLE | REMOVE | REFRESH | CLOSE);
            let child = CreateWindowExW(
                0,
                wide(if button { "BUTTON" } else { "STATIC" }).as_ptr(),
                wide(label).as_ptr(),
                WS_CHILD
                    | WS_VISIBLE
                    | if button {
                        WS_TABSTOP | BS_NOTIFY as u32 | BS_OWNERDRAW as u32
                    } else {
                        windows_sys::Win32::System::SystemServices::SS_NOPREFIX
                    },
                0,
                0,
                1,
                1,
                window,
                id as _,
                instance,
                null(),
            );
            if child.is_null() {
                let error = io::Error::last_os_error();
                DestroyWindow(window);
                return Err(error.into());
            }
        }
        ui.apply_fonts(window);
        ui.layout(window);
        ui.start(window, Action::Refresh);
        if SetTimer(window, 1, 100, None) == 0 {
            let error = io::Error::last_os_error();
            DestroyWindow(window);
            return Err(error.into());
        }
        SetFocus(GetDlgItem(window, CLOSE as i32));
        Ok(window)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keyboard_focus_and_paint_notifications_never_dispatch_service_actions() {
        for id in [SETUP, REPAIR, DISABLE, REMOVE, REFRESH, CLOSE] {
            assert_eq!(clicked_command(id), Some(id));
            for notification in [
                BN_SETFOCUS,
                BN_KILLFOCUS,
                BN_HILITE,
                BN_UNHILITE,
                BN_DISABLE,
                BN_DBLCLK,
            ] {
                assert_eq!(clicked_command(id | ((notification as usize) << 16)), None);
            }
        }
    }
    fn snapshot() -> Snapshot {
        Snapshot {
            paired: true,
            owner_control: true,
            endpoint: Ok(signin_endpoint::Status {
                installed: true,
                automatic: true,
                running: true,
                locally_disabled: false,
                media_ready: false,
                media_supported: false,
                service_matches_build: Some(true),
                recovery_configured: true,
            }),
        }
    }
    #[test]
    fn prepared_service_never_claims_available_media() {
        let mut state = snapshot();
        assert!(state.presentation().0.contains("unavailable"));
        if let Ok(status) = &mut state.endpoint {
            status.media_supported = true;
        }
        assert!(state.presentation().0.contains("Check your workspace"));
        assert!(!state.presentation().0.contains("endpoint ready"));
        if let Ok(status) = &mut state.endpoint {
            status.running = false;
        }
        assert!(state.presentation().0.contains("stopped"));
        if let Ok(status) = &mut state.endpoint {
            status.locally_disabled = true;
        }
        assert!(state.presentation().0.contains("Disabled"));
        assert_eq!(state.presentation().1, "Enable sign-in access…");
    }
    #[test]
    fn maintenance_notice_preserves_disable_and_unknown_is_not_healthy() {
        let mut state = snapshot();
        if let Ok(status) = &mut state.endpoint {
            status.locally_disabled = true;
            status.service_matches_build = Some(false);
            assert_eq!(status.needs_repair(), Some(true));
        }
        let message = state.presentation().0;
        assert!(message.starts_with("Disabled on this computer."));
        assert!(message.contains("Repair service"));
        assert!(message.contains("Disable stays in effect"));
        if let Ok(status) = &mut state.endpoint {
            status.service_matches_build = None;
            assert_eq!(status.needs_repair(), None);
        }
        assert!(state.presentation().0.contains("could not be compared"));
    }
    #[test]
    fn setup_requires_pairing_and_local_owner_control_even_during_repair() {
        let mut state = snapshot();
        state.owner_control = false;
        assert!(!state.presentation().2);
        state.endpoint = Err("Unverified service".into());
        assert!(!state.presentation().2);
        state.owner_control = true;
        assert!(state.presentation().2);
        state.paired = false;
        assert!(!state.presentation().2);
    }

    #[test]
    fn embedded_page_posts_back_and_frees_its_state() {
        unsafe {
            let instance = GetModuleHandleW(null());
            let class = wide("BeaconRemoteSignInSettingsTestParent");
            let registration = WNDCLASSW {
                lpfnWndProc: Some(DefWindowProcW),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                ..Default::default()
            };
            assert_ne!(RegisterClassW(&registration), 0);
            let parent = CreateWindowExW(
                0,
                class.as_ptr(),
                wide("parent").as_ptr(),
                WS_OVERLAPPED,
                0,
                0,
                520,
                560,
                null_mut(),
                null_mut(),
                instance,
                null(),
            );
            assert!(!parent.is_null());
            let mut area = RECT::default();
            GetClientRect(parent, &mut area);
            let page = embed(parent, area, 1.0).expect("embedded page");
            assert_eq!(GetParent(page), parent);
            // Every control exists, and Back is the control that closes the page.
            for id in [SETUP, REPAIR, DISABLE, REMOVE, REFRESH, CLOSE, LABEL] {
                assert!(!GetDlgItem(page, id as i32).is_null());
            }
            let mut text = [0u16; 16];
            GetWindowTextW(GetDlgItem(page, CLOSE as i32), text.as_mut_ptr(), 16);
            assert_eq!(String::from_utf16_lossy(&text[..4]), "Back");
            // Wait for the first status check so Back is enabled, then press it.
            let end = std::time::Instant::now() + std::time::Duration::from_secs(20);
            let mut message = MSG::default();
            while IsWindowEnabled(GetDlgItem(page, CLOSE as i32)) == 0
                && std::time::Instant::now() < end
            {
                while PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) != 0 {
                    DispatchMessageW(&message);
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            SendMessageW(
                page,
                WM_COMMAND,
                CLOSE | ((BN_CLICKED as usize) << 16),
                GetDlgItem(page, CLOSE as i32) as isize,
            );
            assert_ne!(
                PeekMessageW(&mut message, parent, BACK, BACK, PM_REMOVE),
                0,
                "Back is reported to the host window"
            );
            DestroyWindow(page);
            assert_eq!(IsWindow(page), 0);
            DestroyWindow(parent);
            UnregisterClassW(class.as_ptr(), instance);
        }
    }
}
