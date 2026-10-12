//! Interactive host enrollment and presence. Closing waits for the worker to release sharing.
#[path = "../../windows-session/src/window_style.rs"]
mod window_style;

use beacon_remote_agent::{HostError, HostStatus};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
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
    Graphics::Gdi::{GetSysColorBrush, COLOR_WINDOW},
    System::{
        LibraryLoader::GetModuleHandleW, SystemServices::SS_NOPREFIX, Threading::CreateMutexW,
    },
    UI::{
        Controls::EM_SETLIMITTEXT,
        HiDpi::GetDpiForSystem,
        Input::KeyboardAndMouse::{EnableWindow, SetFocus},
        Shell::*,
        WindowsAndMessaging::*,
    },
};
use zeroize::Zeroize;

const ACTION: usize = 101;
const STOP: usize = 102;
const SERVER: usize = 103;
const NAME: usize = 104;
const CODE: usize = 105;
const TRAY_SHOW: usize = 201;
const TRAY_STOP: usize = 202;
const TRAY_QUIT: usize = 203;
const TRAY_MESSAGE: u32 = WM_APP + 1;
const DEFAULT_SERVER: &str = "https://remote.builtbysai.com";

struct Worker {
    handle: JoinHandle<Result<(), HostError>>,
    pairing: bool,
    cancel: Arc<AtomicBool>,
    status: Receiver<HostStatus>,
}
struct State {
    paired: bool,
    closing: bool,
    worker: Option<Worker>,
    server: HWND,
    name: HWND,
    code: HWND,
    action: HWND,
    stop: HWND,
    status: HWND,
    introduction: HWND,
    last_status: Option<HostStatus>,
    enrollment: Vec<HWND>,
    paired_details: Vec<HWND>,
    tray: bool,
    tray_status: String,
    taskbar_created: u32,
}
unsafe fn tray_data(window: HWND, status: &str) -> NOTIFYICONDATAW {
    let mut data = NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: window,
        uID: 1,
        uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP,
        uCallbackMessage: TRAY_MESSAGE,
        hIcon: LoadIconW(null_mut(), IDI_APPLICATION),
        ..Default::default()
    };
    for (target, source) in data.szTip.iter_mut().take(127).zip(status.encode_utf16()) {
        *target = source;
    }
    data
}
unsafe fn restore(window: HWND) {
    ShowWindow(window, SW_RESTORE);
    SetForegroundWindow(window);
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
unsafe fn text(window: HWND, value: &str) {
    SetWindowTextW(window, wide(value).as_ptr());
}
unsafe fn read(window: HWND) -> String {
    let length = GetWindowTextLengthW(window).max(0) as usize;
    let mut buffer = vec![0u16; length + 1];
    let copied = GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32);
    let result = String::from_utf16_lossy(&buffer[..copied.max(0) as usize]);
    buffer.zeroize();
    result
}
impl State {
    unsafe fn controls(&self) {
        text(
            self.introduction,
            if self.paired {
                "Keep this host open while it is available. Screen viewing and control require visible local approval."
            } else {
                "Pair this computer with your workspace. Screen viewing and control require visible local approval."
            },
        );
        let busy = self.worker.is_some();
        for &window in &self.enrollment {
            ShowWindow(window, if self.paired { SW_HIDE } else { SW_SHOW });
            EnableWindow(window, i32::from(!busy && !self.closing));
        }
        for &window in &self.paired_details {
            ShowWindow(window, if self.paired { SW_SHOW } else { SW_HIDE });
        }
        text(
            self.action,
            if self.paired {
                "Start host"
            } else {
                "Pair computer"
            },
        );
        EnableWindow(self.action, i32::from(!busy && !self.closing));
        ShowWindow(self.stop, if self.paired { SW_SHOW } else { SW_HIDE });
        EnableWindow(self.stop, i32::from(busy && !self.closing));
    }
    unsafe fn start(&mut self) {
        if self.worker.is_some() || self.closing {
            return;
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let (sender, status) = mpsc::sync_channel(16);
        let pairing = !self.paired;
        self.last_status = None;
        let handle = if pairing {
            let server = read(self.server);
            let name = read(self.name);
            let mut code = read(self.code);
            text(self.code, "");
            if server.trim().is_empty() || name.trim().is_empty() || code.trim().is_empty() {
                code.zeroize();
                text(
                    self.status,
                    "Enter the server, computer name, and pairing code from your workspace.",
                );
                return;
            }
            text(self.status, "Pairing computer… Please wait.");
            thread::spawn(move || beacon_remote_agent::pair(server.trim(), name.trim(), code))
        } else {
            text(self.status, "Connecting to your workspace…");
            let worker_cancel = cancel.clone();
            thread::spawn(move || beacon_remote_agent::run(worker_cancel, sender))
        };
        self.worker = Some(Worker {
            handle,
            pairing,
            cancel,
            status,
        });
        self.controls();
    }
    unsafe fn stop(&mut self) {
        if let Some(worker) = &self.worker {
            worker.cancel.store(true, Ordering::SeqCst);
            text(self.status, "Stopping host and releasing sharing…");
            EnableWindow(self.stop, 0);
        }
    }
    unsafe fn poll(&mut self, window: HWND) {
        if let Some(worker) = &self.worker {
            while let Ok(status) = worker.status.try_recv() {
                self.last_status = Some(status);
                if !self.closing && !worker.cancel.load(Ordering::SeqCst) {
                    text(self.status, match status {
                        HostStatus::Connecting => "Connecting to your workspace…",
                        HostStatus::Online => "Online · Available for locally approved requests.",
                        HostStatus::Retrying => "Connection interrupted · Retrying. Check your network.",
                        HostStatus::Stopped => "Stopped · This host is no longer sharing.",
                        HostStatus::Rejected => "Host authorization rejected. Check this computer in your workspace.",
                    });
                }
            }
        }
        if self
            .worker
            .as_ref()
            .is_some_and(|worker| worker.handle.is_finished())
        {
            let worker = self.worker.take().unwrap();
            let success = matches!(worker.handle.join(), Ok(Ok(())));
            if worker.pairing && success {
                self.paired = beacon_remote_agent::is_paired();
                text(
                    self.status,
                    "Computer paired · Select Start host to make it available.",
                );
            } else if success {
                text(
                    self.status,
                    "Stopped · Select Start host when you are ready.",
                );
            } else if worker.pairing {
                text(self.status, "Pairing failed. Check the server and network, then request a fresh code in your workspace.");
            } else if self.last_status == Some(HostStatus::Rejected) {
                text(self.status, "Host authorization rejected. Check this computer in your workspace before trying again.");
            } else {
                text(self.status, "Host stopped. Check your network and computer authorization, then try Start host.");
            }
            self.controls();
        }
        if self.closing && self.worker.is_none() {
            DestroyWindow(window);
        } else if self.tray {
            let status = format!("Beacon Remote · {}", read(self.status));
            if self.tray_status != status {
                Shell_NotifyIconW(NIM_MODIFY, &tray_data(window, &status));
                self.tray_status = status;
            }
        }
    }
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
    if !state.is_null() && message == (*state).taskbar_created && message != 0 {
        (*state).tray = Shell_NotifyIconW(NIM_ADD, &tray_data(window, "Beacon Remote host")) != 0;
        (*state).tray_status.clear();
        if !(*state).tray {
            restore(window);
        }
        return 0;
    }
    match message {
        DM_GETDEFID => return ((DC_HASDEFID as usize) << 16 | ACTION) as isize,
        WM_CTLCOLORSTATIC => return window_style::static_background(wparam),
        WM_COMMAND if !state.is_null() && (wparam >> 16) == BN_CLICKED as usize => {
            match wparam & 0xffff {
                ACTION => (*state).start(),
                STOP => (*state).stop(),
                TRAY_SHOW => restore(window),
                TRAY_STOP => (*state).stop(),
                TRAY_QUIT => {
                    SendMessageW(window, WM_CLOSE, 0, 0);
                }
                _ => {}
            }
            return 0;
        }
        WM_SIZE if !state.is_null() && wparam == SIZE_MINIMIZED as usize && (*state).tray => {
            ShowWindow(window, SW_HIDE);
            return 0;
        }
        TRAY_MESSAGE if !state.is_null() => {
            if lparam as u32 == WM_LBUTTONDBLCLK {
                restore(window);
            } else if lparam as u32 == WM_RBUTTONUP {
                let menu = CreatePopupMenu();
                if !menu.is_null() {
                    AppendMenuW(
                        menu,
                        MF_STRING,
                        TRAY_SHOW,
                        wide("Show Beacon Remote").as_ptr(),
                    );
                    let stoppable = (*state).worker.as_ref().is_some_and(|worker| {
                        !worker.pairing && !worker.cancel.load(Ordering::SeqCst)
                    });
                    AppendMenuW(
                        menu,
                        MF_STRING | if stoppable { 0 } else { MF_GRAYED },
                        TRAY_STOP,
                        wide("Stop host").as_ptr(),
                    );
                    AppendMenuW(menu, MF_STRING, TRAY_QUIT, wide("Quit").as_ptr());
                    let mut point = POINT::default();
                    GetCursorPos(&mut point);
                    SetForegroundWindow(window);
                    TrackPopupMenu(menu, TPM_RIGHTBUTTON, point.x, point.y, 0, window, null());
                    DestroyMenu(menu);
                    PostMessageW(window, WM_NULL, 0, 0);
                }
            }
            return 0;
        }
        WM_TIMER if !state.is_null() => {
            (*state).poll(window);
            return 0;
        }
        WM_CLOSE if !state.is_null() => {
            (*state).closing = true;
            if (*state).worker.is_some() {
                restore(window);
            }
            (*state).stop();
            (*state).controls();
            (*state).poll(window);
            return 0;
        }
        WM_DESTROY => {
            if !state.is_null() && (*state).tray {
                Shell_NotifyIconW(NIM_DELETE, &tray_data(window, ""));
                (*state).tray = false;
            }
            KillTimer(window, 1);
            PostQuitMessage(0);
            return 0;
        }
        WM_NCDESTROY => {
            SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        }
        _ => {}
    }
    DefWindowProcW(window, message, wparam, lparam)
}

pub fn show() -> Result<(), io::Error> {
    unsafe {
        let local = std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| io::Error::other("LOCALAPPDATA required"))?;
        let mut hasher = DefaultHasher::new();
        local.to_string_lossy().to_lowercase().hash(&mut hasher);
        let mutex_name = wide(&format!("Local\\BeaconRemoteHost-{:016x}", hasher.finish()));
        let mutex = CreateMutexW(null(), 0, mutex_name.as_ptr());
        if mutex.is_null() {
            return Err(io::Error::last_os_error());
        }
        struct Instance(HANDLE);
        impl Drop for Instance {
            fn drop(&mut self) {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
        let _instance_guard = Instance(mutex);
        if GetLastError() == ERROR_ALREADY_EXISTS {
            MessageBoxW(null_mut(), wide("Beacon Remote host is already open. Use its existing window to start or stop sharing.").as_ptr(), wide("Beacon Remote").as_ptr(), MB_OK | MB_ICONINFORMATION);
            return Ok(());
        }
        let scale = |value| value * GetDpiForSystem().max(96) as i32 / 96;
        let font = window_style::Font::new(scale(16))?;
        let heading_font = window_style::Font::new(scale(24))?;
        let instance = GetModuleHandleW(null());
        let class = wide("BeaconRemoteHostWindow");
        let registration = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: GetSysColorBrush(COLOR_WINDOW),
            ..Default::default()
        };
        if RegisterClassW(&registration) == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut state = State {
            paired: beacon_remote_agent::is_paired(),
            closing: false,
            worker: None,
            server: null_mut(),
            name: null_mut(),
            code: null_mut(),
            action: null_mut(),
            stop: null_mut(),
            status: null_mut(),
            introduction: null_mut(),
            last_status: None,
            enrollment: Vec::new(),
            paired_details: Vec::new(),
            tray: false,
            tray_status: String::new(),
            taskbar_created: RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()),
        };
        let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
        let mut bounds = RECT {
            left: 0,
            top: 0,
            right: scale(580),
            bottom: scale(520),
        };
        AdjustWindowRectEx(&mut bounds, style, 0, 0);
        let window = CreateWindowExW(
            0,
            class.as_ptr(),
            wide("Beacon Remote — Windows host").as_ptr(),
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
        let child =
            |class: &str, label: &str, x, y, width, height, extra, id| -> Result<HWND, io::Error> {
                let control = CreateWindowExW(
                    0,
                    wide(class).as_ptr(),
                    wide(label).as_ptr(),
                    WS_CHILD | WS_VISIBLE | extra,
                    scale(x),
                    scale(y),
                    scale(width),
                    scale(height),
                    window,
                    id as HMENU,
                    instance,
                    null(),
                );
                if control.is_null() {
                    return Err(io::Error::last_os_error());
                }
                SendMessageW(control, WM_SETFONT, font.0 as usize, 1);
                Ok(control)
            };
        let build = (|| -> Result<(), io::Error> {
            let title = child("STATIC", "Beacon Remote", 28, 24, 524, 36, SS_NOPREFIX, 0)?;
            SendMessageW(title, WM_SETFONT, heading_font.0 as usize, 1);
            child("STATIC", "Windows host", 28, 65, 524, 25, SS_NOPREFIX, 0)?;
            state.introduction = child("STATIC", "", 28, 104, 524, 48, SS_NOPREFIX, 0)?;
            // Adjacent creation order lets native accessibility associate each label with its edit.
            state
                .enrollment
                .push(child("STATIC", "Server", 28, 172, 524, 24, SS_NOPREFIX, 0)?);
            state.server = child(
                "EDIT",
                DEFAULT_SERVER,
                28,
                198,
                524,
                30,
                WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL as u32,
                SERVER,
            )?;
            state.enrollment.push(child(
                "STATIC",
                "Computer name",
                28,
                244,
                524,
                24,
                SS_NOPREFIX,
                0,
            )?);
            state.name = child(
                "EDIT",
                &std::env::var("COMPUTERNAME").unwrap_or_default(),
                28,
                270,
                524,
                30,
                WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL as u32,
                NAME,
            )?;
            state.enrollment.push(child(
                "STATIC",
                "Pairing code from your workspace",
                28,
                316,
                524,
                24,
                SS_NOPREFIX,
                0,
            )?);
            state.code = child(
                "EDIT",
                "",
                28,
                342,
                524,
                30,
                WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL as u32 | ES_PASSWORD as u32,
                CODE,
            )?;
            SendMessageW(state.server, EM_SETLIMITTEXT, 2048, 0);
            SendMessageW(state.name, EM_SETLIMITTEXT, 80, 0);
            SendMessageW(state.code, EM_SETLIMITTEXT, 256, 0);
            state
                .enrollment
                .extend([state.server, state.name, state.code]);
            state.paired_details.push(child(
                "STATIC",
                "This computer",
                28,
                180,
                524,
                25,
                SS_NOPREFIX,
                0,
            )?);
            state.paired_details.push(child(
                "STATIC",
                &std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows computer".into()),
                28,
                212,
                524,
                30,
                SS_NOPREFIX,
                0,
            )?);
            state.paired_details.push(child(
                "STATIC",
                "Access policy",
                28,
                270,
                524,
                25,
                SS_NOPREFIX,
                0,
            )?);
            state.paired_details.push(child("STATIC", "Every new request requires approval on this computer.\r\nStop host ends sharing and disconnects the host.", 28, 304, 524, 60, SS_NOPREFIX, 0)?);
            state.status = child(
                "STATIC",
                if state.paired {
                    "Computer paired · Select Start host to make it available."
                } else {
                    "Not paired · Generate a code in your signed-in workspace."
                },
                28,
                393,
                524,
                52,
                SS_NOPREFIX,
                0,
            )?;
            state.action = child(
                "BUTTON",
                "Pair computer",
                28,
                462,
                172,
                34,
                WS_TABSTOP | BS_DEFPUSHBUTTON as u32,
                ACTION,
            )?;
            state.stop = child("BUTTON", "Stop host", 216, 462, 156, 34, WS_TABSTOP, STOP)?;
            state.controls();
            Ok(())
        })();
        if let Err(error) = build {
            DestroyWindow(window);
            UnregisterClassW(class.as_ptr(), instance);
            return Err(error);
        }
        if SetTimer(window, 1, 100, None) == 0 {
            DestroyWindow(window);
            UnregisterClassW(class.as_ptr(), instance);
            return Err(io::Error::last_os_error());
        }
        state.tray = Shell_NotifyIconW(NIM_ADD, &tray_data(window, "Beacon Remote host")) != 0;
        ShowWindow(window, SW_SHOW);
        SetFocus(if state.paired {
            state.action
        } else {
            state.code
        });
        let mut message = MSG::default();
        loop {
            let result = GetMessageW(&mut message, null_mut(), 0, 0);
            if result <= 0 {
                break;
            }
            if IsDialogMessageW(window, &message) == 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        // Also release the worker if Windows terminates the message loop unexpectedly.
        if let Some(worker) = state.worker.take() {
            worker.cancel.store(true, Ordering::SeqCst);
            let _ = worker.handle.join();
        }
        if IsWindow(window) != 0 {
            DestroyWindow(window);
        }
        UnregisterClassW(class.as_ptr(), instance);
        Ok(())
    }
}
pub fn show_startup_error() {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide("Beacon Remote could not open the host window. Try launching it again.").as_ptr(),
            wide("Beacon Remote").as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}
