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
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC,
        DeleteObject, EndPaint, FillRect, InvalidateRect, ScreenToClient, SelectObject, SetBkMode,
        SetTextColor, HFONT, PAINTSTRUCT, SRCCOPY, TRANSPARENT,
    },
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Controls::{DRAWITEMSTRUCT, ODS_DISABLED, ODS_FOCUS, ODS_SELECTED},
        HiDpi::GetDpiForSystem,
        Input::KeyboardAndMouse::SetFocus,
        WindowsAndMessaging::*,
    },
};

// Edit control messages.
const EM_SETSEL: u32 = 0x00B1;
const EM_SCROLLCARET: u32 = 0x00B7;
const EM_LIMITTEXT: u32 = 0x00C5;
const END: usize = 101;
const SEND: usize = 103;
const INPUT: usize = 104;
const LOG: usize = 105;
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

/// The conversation, shared between the window and the thread that talks to the server.
#[derive(Default)]
struct Chat {
    messages: Vec<support::ChatMessage>,
    outbox: Vec<String>,
    /// Bumped when `messages` changes, so the window redraws only then.
    version: u64,
}

struct State {
    window: HWND,
    helper: HWND,
    log: HWND,
    input: HWND,
    chat: Arc<Mutex<Chat>>,
    shown: u64,
    status: HWND,
    remove: HWND,
    end: HWND,
    palette: ui::Palette,
    scale: f32,
    // The control the pointer is over (for button hover), and whether Beacon Remote is removed afterwards.
    hot: i32,
    remove_on: bool,
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
        support::set_remove_wanted(self.remove_on);
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
    /// Shows new chat lines, and names the technician again if the session was handed over.
    unsafe fn show_chat(&mut self) {
        let (version, text, from_them) = {
            let chat = self.chat.lock().unwrap();
            if chat.version == self.shown {
                return;
            }
            let text = chat
                .messages
                .iter()
                .map(|line| match line.sender.as_str() {
                    "person" => format!("You: {}", line.body),
                    "technician" => format!("Technician: {}", line.body),
                    _ => line.body.clone(),
                })
                .collect::<Vec<_>>()
                .join("\r\n");
            let newest = chat.messages.last().map(|line| line.sender != "person");
            (chat.version, text, newest.unwrap_or(false))
        };
        let first = self.shown == 0;
        self.shown = version;
        SetWindowTextW(self.log, wide(&text).as_ptr());
        // Scroll to the newest line.
        SendMessageW(self.log, EM_SETSEL, usize::MAX, -1);
        SendMessageW(self.log, EM_SCROLLCARET, 0, 0);
        SetWindowTextW(self.helper, wide(&support::technician()).as_ptr());
        // A new message from them draws attention if this window is not the one in front.
        if from_them && !first && GetForegroundWindow() != self.window {
            FlashWindow(self.window, 1);
        }
    }
    /// Repaints the button the pointer moved onto or off of.
    unsafe fn track_hover(&mut self) {
        let mut point = POINT { x: 0, y: 0 };
        GetCursorPos(&mut point);
        ScreenToClient(self.window, &mut point);
        let over = ChildWindowFromPoint(self.window, point);
        let id = if over.is_null() || over == self.window {
            0
        } else {
            GetDlgCtrlID(over)
        };
        if id != self.hot {
            for old_or_new in [self.hot, id] {
                let control = GetDlgItem(self.window, old_or_new);
                if !control.is_null() {
                    InvalidateRect(control, null(), 0);
                }
            }
            self.hot = id;
        }
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
                HostStatus::Stopped | HostStatus::Rejected | HostStatus::Removed => "Support has ended.",
            });
        }
        self.show_chat();
        self.track_hover();
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

const HELPER_ID: i32 = 304;

unsafe fn paint(window: HWND, state: &State) {
    let mut ps: PAINTSTRUCT = std::mem::zeroed();
    let hdc = BeginPaint(window, &mut ps);
    let mut client = RECT::default();
    GetClientRect(window, &mut client);
    let (w, h) = (client.right, client.bottom);
    let buffer = CreateCompatibleDC(hdc);
    let bitmap = CreateCompatibleBitmap(hdc, w, h);
    let old = SelectObject(buffer, bitmap);
    let brush = CreateSolidBrush(ui::colorref(state.palette.window));
    FillRect(buffer, &client, brush);
    DeleteObject(brush);
    if let Some(canvas) = ui::Canvas::new(buffer, state.scale) {
        let p = &state.palette;
        // "Temporary" beside the heading: this is not an installation.
        ui::pill(
            &canvas,
            (366.0, 29.0, 106.0, 24.0),
            "Temporary",
            p.warn_soft,
            p.warn_line,
            p.warn,
        );
        // The technician card.
        canvas.fill(28.0, 66.0, 444.0, 72.0, 10.0, p.surface);
        canvas.stroke(28.0, 66.0, 444.0, 72.0, 10.0, p.line, 1.0);
        ui::avatar(
            &canvas,
            p,
            62.0,
            102.0,
            20.0,
            &ui::initials(&support::technician()),
        );
        canvas.text(
            "TECHNICIAN",
            (96.0, 74.0, 200.0, 14.0),
            10.5,
            600,
            p.faint,
            ui::Align::Left,
            false,
        );
    }
    BitBlt(hdc, 0, 0, w, h, buffer, 0, 0, SRCCOPY);
    SelectObject(buffer, old);
    DeleteObject(bitmap);
    DeleteDC(buffer);
    EndPaint(window, &ps);
}

unsafe fn draw_item(state: &State, item: &DRAWITEMSTRUCT) {
    let w = (item.rcItem.right - item.rcItem.left) as f32 / state.scale;
    let h = (item.rcItem.bottom - item.rcItem.top) as f32 / state.scale;
    let id = item.CtlID as i32;
    let brush = CreateSolidBrush(ui::colorref(state.palette.window));
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
    match id as usize {
        END => ui::button(&canvas, p, (w, h), "End support", ui::Role::Danger, flags),
        SEND => ui::button(&canvas, p, (w, h), "Send", ui::Role::Primary, flags),
        _ => ui::checkbox(
            &canvas,
            p,
            (w, h),
            "Remove Beacon Remote when support ends",
            state.remove_on,
            flags,
        ),
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
            paint(window, &*state);
            return 0;
        }
        WM_DRAWITEM if !state.is_null() => {
            draw_item(&*state, &*(lparam as *const DRAWITEMSTRUCT));
            return 1;
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
            // The technician's name sits on the card, everything else on the window.
            let backdrop = if GetDlgCtrlID(lparam as HWND) == HELPER_ID {
                p.surface
            } else {
                p.window
            };
            return ui::surface_brush(backdrop) as isize;
        }
        WM_COMMAND if !state.is_null() && (wparam & 0xffff) == SEND => {
            let mut buffer = [0u16; 1100];
            let length = GetWindowTextW((*state).input, buffer.as_mut_ptr(), 1100) as usize;
            let text = String::from_utf16_lossy(&buffer[..length])
                .trim()
                .to_owned();
            if !text.is_empty() {
                (*state).chat.lock().unwrap().outbox.push(text);
                SetWindowTextW((*state).input, wide("").as_ptr());
            }
            return 0;
        }
        WM_CTLCOLOREDIT if !state.is_null() => {
            let p = &(*state).palette;
            SetTextColor(wparam as _, ui::colorref(p.text));
            SetBkMode(wparam as _, TRANSPARENT as i32);
            return ui::surface_brush(p.surface) as isize;
        }
        WM_COMMAND if !state.is_null() && (wparam & 0xffff) == REMOVE => {
            (*state).remove_on = !(*state).remove_on;
            InvalidateRect((*state).remove, null(), 0);
            return 0;
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
            helper: null_mut(),
            log: null_mut(),
            input: null_mut(),
            chat: Arc::new(Mutex::new(Chat::default())),
            shown: 0,
            status: null_mut(),
            remove: null_mut(),
            end: null_mut(),
            palette: ui::palette(),
            scale: factor,
            hot: 0,
            remove_on: true,
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
            bottom: px(528),
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
        let child_at = |class: &str,
                        label: &str,
                        x: i32,
                        y: i32,
                        width: i32,
                        height: i32,
                        extra: u32,
                        id: usize| {
            CreateWindowExW(
                0,
                wide(class).as_ptr(),
                wide(label).as_ptr(),
                WS_CHILD | WS_VISIBLE | extra,
                px(x),
                px(y),
                px(width),
                px(height),
                window,
                id as _,
                instance,
                null(),
            )
        };
        let heading = child_at(
            "STATIC",
            "Temporary support",
            28,
            24,
            330,
            34,
            0,
            H_HEADING as usize,
        );
        let helper = child_at("STATIC", &who, 96, 90, 366, 40, 0, HELPER_ID as usize);
        state.helper = helper;
        state.status = child(
            "STATIC",
            if resuming {
                "Resuming support after an interruption…"
            } else {
                "Connecting to your technician…"
            },
            150,
            44,
            0,
            H_STATUS as usize,
        );
        let info = child(
            "STATIC",
            "Temporary: this does not start with Windows or give anyone lasting access. When support ends, access is revoked and the files and sign-in Beacon Remote created here are removed.",
            196,
            60,
            0,
            H_INFO as usize,
        );
        state.remove = child(
            "BUTTON",
            "Remove Beacon Remote when support ends",
            436,
            26,
            (BS_OWNERDRAW as u32) | WS_TABSTOP,
            REMOVE,
        );
        state.end = child(
            "BUTTON",
            "End support",
            472,
            40,
            (BS_OWNERDRAW as u32) | WS_TABSTOP,
            END,
        );
        // The conversation with the technician. Enter sends, so End support is never the default button.
        state.log = child_at(
            "EDIT",
            "",
            28,
            262,
            444,
            120,
            (ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL) as u32 | WS_VSCROLL | WS_BORDER,
            LOG,
        );
        state.input = child_at(
            "EDIT",
            "",
            28,
            392,
            350,
            28,
            (ES_AUTOHSCROLL as u32) | WS_TABSTOP | WS_BORDER,
            INPUT,
        );
        SendMessageW(state.input, EM_LIMITTEXT, 1000, 0);
        let send = child_at(
            "BUTTON",
            "Send",
            388,
            388,
            84,
            36,
            (BS_OWNERDRAW as u32) | WS_TABSTOP,
            SEND,
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
            (state.log, body),
            (state.input, body),
            (send, body),
        ] {
            SendMessageW(handle, WM_SETFONT, font as usize, 1);
        }
        {
            // Talks to the server for the conversation; a missing identity (before the link is claimed) just retries.
            let chat = state.chat.clone();
            let stop = state.cancel.clone();
            thread::spawn(move || {
                let mut since = 0u64;
                while !stop.load(Ordering::Acquire) {
                    let outgoing = chat.lock().unwrap().outbox.first().cloned();
                    let got = support::chat_exchange(since, outgoing.as_deref());
                    if let Ok(new) = got {
                        let mut chat = chat.lock().unwrap();
                        if outgoing.is_some() && !chat.outbox.is_empty() {
                            chat.outbox.remove(0);
                        }
                        if let Some(last) = new.last() {
                            since = since.max(last.id);
                            chat.messages.extend(new);
                            chat.version += 1;
                        }
                    }
                    let wait = if outgoing.is_some() { 5 } else { 30 };
                    for _ in 0..wait {
                        if stop.load(Ordering::Acquire) || !chat.lock().unwrap().outbox.is_empty() {
                            break;
                        }
                        thread::sleep(Duration::from_millis(100));
                    }
                }
            });
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
