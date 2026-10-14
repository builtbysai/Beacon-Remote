//! The temporary support window (ADR 0038): who is helping, whether they are connected, one clear way to end support,
//! and the choice to remove Beacon Remote afterwards. Viewing and control are still approved and stopped through the
//! same session consent window and sharing indicator as every other session.
use crate::host_window::native_ui as ui;
use beacon_remote_agent::{support, HostError, HostStatus};
use std::{
    io,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc,
    },
    thread::{self, JoinHandle},
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::{
        BeginPaint, EndPaint, FillRect, SetBkMode, SetTextColor, HFONT, PAINTSTRUCT, TRANSPARENT,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{HiDpi::GetDpiForSystem, Input::KeyboardAndMouse::SetFocus, WindowsAndMessaging::*},
};

const BST_CHECKED: u32 = 1;
const END: usize = 101;
const REMOVE: usize = 102;
const H_HEADING: i32 = 301;
const H_STATUS: i32 = 302;
const H_INFO: i32 = 303;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
fn say(text: &str, flags: u32) -> i32 {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide(text).as_ptr(),
            wide("Beacon Remote · Temporary support").as_ptr(),
            flags,
        )
    }
}

struct State {
    window: HWND,
    status: HWND,
    remove: HWND,
    end: HWND,
    palette: ui::Palette,
    fonts: Vec<HFONT>,
    cancel: Arc<AtomicBool>,
    updates: Receiver<HostStatus>,
    worker: Option<JoinHandle<Result<(), HostError>>>,
    ending: Option<JoinHandle<()>>,
    started: bool,
    root: std::path::PathBuf,
    download: Option<std::path::PathBuf>,
}

impl State {
    unsafe fn set_status(&self, text: &str) {
        SetWindowTextW(self.status, wide(text).as_ptr());
    }
    /// Stops sharing, tells the server, and removes what this client created (as the person chose).
    unsafe fn finish(&mut self, reason: &str) {
        if self.ending.is_some() {
            return;
        }
        self.set_status(reason);
        // On purpose: a supervisor must now clean up rather than bring support back.
        support::mark_ended();
        EnableWindowControls(self);
        support::set_remove_wanted(
            SendMessageW(self.remove, BM_GETCHECK, 0, 0) == BST_CHECKED as isize,
        );
        self.cancel.store(true, Ordering::SeqCst);
        let worker = self.worker.take();
        let started = self.started;
        let (root, download) = (self.root.clone(), self.download.clone());
        self.ending = Some(thread::spawn(move || {
            if started {
                support::end();
            }
            if let Some(worker) = worker {
                let _ = worker.join();
            }
            let _ = support::cleanup(&root, download.as_deref());
        }));
    }
    unsafe fn poll(&mut self) {
        while let Ok(status) = self.updates.try_recv() {
            if self.ending.is_some() {
                continue;
            }
            self.started = true;
            self.set_status(match status {
                HostStatus::Connecting => "Connecting to your technician…",
                HostStatus::Online => "Ready. You will be asked to allow each connection, and you can stop at any time.",
                HostStatus::Retrying => "Connection interrupted · Trying again. Check your network.",
                HostStatus::Stopped | HostStatus::Rejected => "Support has ended.",
            });
        }
        if self.ending.is_none() {
            if support::expired() {
                self.finish(
                    "The time limit for this support session was reached. Removing Beacon Remote…",
                );
            } else if self
                .worker
                .as_ref()
                .is_some_and(|worker| worker.is_finished())
            {
                // The technician ended support, the link ran out, or the computer could not connect.
                self.finish("Support has ended. Removing Beacon Remote…");
            }
        }
        if self.ending.as_ref().is_some_and(|job| job.is_finished()) {
            DestroyWindow(self.window);
        }
    }
}

#[allow(non_snake_case)]
unsafe fn EnableWindowControls(state: &State) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
    EnableWindow(state.end, 0);
    EnableWindow(state.remove, 0);
}

unsafe extern "system" fn procedure(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(lparam as *const CREATESTRUCTW);
        SetWindowLongPtrW(window, GWLP_USERDATA, create.lpCreateParams as isize);
    }
    let state = GetWindowLongPtrW(window, GWLP_USERDATA) as *mut State;
    match message {
        WM_ERASEBKGND if !state.is_null() => {
            let mut area = RECT::default();
            GetClientRect(window, &mut area);
            let brush = ui::surface_brush((*state).palette.window);
            FillRect(wparam as _, &area, brush);
            return 1;
        }
        WM_PAINT if !state.is_null() => {
            let mut paint = PAINTSTRUCT::default();
            BeginPaint(window, &mut paint);
            EndPaint(window, &paint);
            return 0;
        }
        WM_CTLCOLORSTATIC if !state.is_null() => {
            let p = &(*state).palette;
            let color = match GetDlgCtrlID(lparam as HWND) {
                H_HEADING => p.strong,
                H_STATUS | H_INFO => p.muted,
                _ => p.text,
            };
            SetTextColor(wparam as _, ui::colorref(color));
            SetBkMode(wparam as _, TRANSPARENT as i32);
            return ui::surface_brush(p.window) as isize;
        }
        WM_COMMAND if !state.is_null() && (wparam & 0xffff) == END => {
            if (*state).ending.is_none() {
                (*state).finish("Ending support and removing Beacon Remote…");
            }
            return 0;
        }
        WM_TIMER if !state.is_null() => {
            (*state).poll();
            return 0;
        }
        WM_CLOSE if !state.is_null() => {
            // Closing the window is ending support; it is never hidden away while it may still be sharing.
            if (*state).ending.is_none() {
                (*state).finish("Ending support and removing Beacon Remote…");
            }
            return 0;
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            return 0;
        }
        _ => {}
    }
    DefWindowProcW(window, message, wparam, lparam)
}

/// Runs temporary support for one link until it ends, then removes what it created.
pub fn show(token: Option<&str>) -> Result<(), io::Error> {
    let root = support::root()
        .ok_or_else(|| io::Error::other("Temporary support must be started from its folder"))?;
    let download = std::env::var_os("BEACON_SUPPORT_DOWNLOAD").map(std::path::PathBuf::from);
    let leave = |text: &str| {
        say(text, MB_OK | MB_ICONINFORMATION);
        let _ = support::cleanup(&root, download.as_deref());
        Ok(())
    };
    // After a crash or a restart the session continues with its existing temporary identity. Otherwise nothing is sent
    // from this computer until the person has seen who is asking and agreed.
    let resuming = support::can_resume();
    let who = if resuming {
        support::technician()
    } else {
        let Some(token) = token else {
            return Ok(());
        };
        let preview = match support::preview(token) {
            Ok(preview) => preview,
            Err(_) => {
                return leave(
                    "This support link has expired, was already used, or could not be reached.\n\nAsk your technician for a new link. Nothing was installed or changed.",
                )
            }
        };
        let who = if preview.technician.is_empty() {
            "Someone".to_owned()
        } else {
            preview.technician.clone()
        };
        let ask = format!(
            "{who} would like to help you remotely.\n\nThey can ask to {}. Nothing is shared until you choose Allow on your screen each time, and you can stop at any time.\n\nThis is temporary. It does not start with Windows, gives no one standing access, and removes itself when support ends.\n\nStart temporary support?",
            if preview.control { "see your screen and control it" } else { "see your screen" }
        );
        if say(&ask, MB_YESNO | MB_ICONQUESTION) != IDYES {
            return leave("Support was not started. Nothing was installed or changed.");
        }
        who
    };
    unsafe {
        let factor = GetDpiForSystem().max(96) as f32 / 96.0;
        let px = move |value: i32| (value as f32 * factor).round() as i32;
        let instance = GetModuleHandleW(null());
        let class = wide("BeaconRemoteSupportWindow");
        let registration = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hIcon: LoadIconW(instance, 1 as _),
            ..Default::default()
        };
        if RegisterClassW(&registration) == 0 {
            return Err(io::Error::last_os_error());
        }
        let (sender, updates) = mpsc::sync_channel(16);
        let cancel = Arc::new(AtomicBool::new(false));
        let mut state = State {
            window: null_mut(),
            status: null_mut(),
            remove: null_mut(),
            end: null_mut(),
            palette: ui::palette(),
            fonts: Vec::new(),
            cancel: cancel.clone(),
            updates,
            worker: None,
            ending: None,
            started: false,
            root: root.clone(),
            download: download.clone(),
        };
        let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
        let mut bounds = RECT {
            left: 0,
            top: 0,
            right: px(500),
            bottom: px(330),
        };
        AdjustWindowRectEx(&mut bounds, style, 0, 0);
        let window = CreateWindowExW(
            0,
            class.as_ptr(),
            wide("Beacon Remote · Temporary support").as_ptr(),
            style,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            bounds.right - bounds.left,
            bounds.bottom - bounds.top,
            null_mut(),
            null_mut(),
            instance,
            std::ptr::from_mut(&mut state).cast(),
        );
        if window.is_null() {
            UnregisterClassW(class.as_ptr(), instance);
            return Err(io::Error::last_os_error());
        }
        state.window = window;
        ui::style_title_bar(window as isize, ui::dark_mode());
        let child = |class: &str, label: &str, y: i32, height: i32, extra: u32, id: usize| {
            CreateWindowExW(
                0,
                wide(class).as_ptr(),
                wide(label).as_ptr(),
                WS_CHILD | WS_VISIBLE | extra,
                px(28),
                px(y),
                px(444),
                px(height),
                window,
                id as _,
                instance,
                null(),
            )
        };
        let heading = child("STATIC", "Temporary support", 24, 34, 0, H_HEADING as usize);
        let helper = child("STATIC", &format!("{who} is helping you"), 62, 40, 0, 304);
        state.status = child(
            "STATIC",
            if resuming {
                "Resuming support after an interruption…"
            } else {
                "Connecting to your technician…"
            },
            108,
            54,
            0,
            H_STATUS as usize,
        );
        let info = child(
            "STATIC",
            "Temporary: this does not start with Windows or give anyone lasting access. When support ends, access is revoked and the files and sign-in Beacon Remote created here are removed.",
            166,
            66,
            0,
            H_INFO as usize,
        );
        state.remove = child(
            "BUTTON",
            "Remove Beacon Remote when support ends",
            244,
            26,
            (BS_AUTOCHECKBOX as u32) | WS_TABSTOP,
            REMOVE,
        );
        SendMessageW(state.remove, BM_SETCHECK, BST_CHECKED as usize, 0);
        state.end = child(
            "BUTTON",
            "End support",
            278,
            36,
            (BS_DEFPUSHBUTTON as u32) | WS_TABSTOP,
            END,
        );
        let big = ui::gdi_font(px(23), 600);
        let strong = ui::gdi_font(px(14), 600);
        let body = ui::gdi_font(px(13), 400);
        state.fonts = vec![big, strong, body];
        for (handle, font) in [
            (heading, big),
            (helper, strong),
            (state.status, body),
            (info, body),
            (state.remove, body),
            (state.end, body),
        ] {
            SendMessageW(handle, WM_SETFONT, font as usize, 1);
        }
        let token_owned = token.map(str::to_owned);
        let name = std::env::var("COMPUTERNAME")
            .ok()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "Windows computer".into());
        state.worker = Some(thread::spawn(move || {
            let _ = sender.try_send(HostStatus::Connecting);
            if let Some(token) = &token_owned {
                if !resuming {
                    support::claim(token, &name)?;
                }
            }
            beacon_remote_agent::run(cancel, sender)
        }));
        if SetTimer(window, 1, 200, None) == 0 {
            DestroyWindow(window);
            UnregisterClassW(class.as_ptr(), instance);
            return Err(io::Error::last_os_error());
        }
        ShowWindow(window, SW_SHOW);
        SetFocus(state.end);
        let mut message = MSG::default();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            if IsDialogMessageW(window, &message) == 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        // Nothing keeps sharing. If this was not a deliberate end (the session was cut off) the supervisor brings support
        // back, so nothing is removed here.
        state.cancel.store(true, Ordering::SeqCst);
        if let Some(job) = state.ending.take() {
            let _ = job.join();
        } else if let Some(worker) = state.worker.take() {
            let _ = worker.join();
        }
        for font in state.fonts.drain(..) {
            ui::delete_font(font);
        }
        UnregisterClassW(class.as_ptr(), instance);
        Ok(())
    }
}
