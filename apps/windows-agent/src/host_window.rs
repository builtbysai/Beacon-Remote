//! Interactive host enrollment and presence. Closing waits for the worker to release sharing.
#[path = "../../windows-session/src/native_ui.rs"]
pub mod native_ui;
use native_ui as ui;

use beacon_remote_agent::{HostError, HostStatus, LocalAccess, SupportCode, UpdateOffer};
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
    Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC,
        DeleteObject, EndPaint, FillRect, GetStockObject, InvalidateRect, MapWindowPoints,
        ScreenToClient, SelectObject, SetBkColor, SetBkMode, SetTextColor, HFONT, NULL_BRUSH,
        PAINTSTRUCT, SRCCOPY, TRANSPARENT,
    },
    System::{
        LibraryLoader::GetModuleHandleW, Registry::*, SystemServices::SS_NOPREFIX,
        Threading::CreateMutexW,
    },
    UI::{
        Controls::{DRAWITEMSTRUCT, EM_SETLIMITTEXT, ODS_DISABLED, ODS_FOCUS, ODS_SELECTED},
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
const AUTOSTART: usize = 120;
const FILES: usize = 121;
const UPDATE: usize = 150;
const SUPPORT_VIEW: usize = 130;
const SUPPORT_CONTROL: usize = 131;
const HELPERS_OFF: usize = 140;
const HELPERS_VIEW: usize = 141;
const HELPERS_CONTROL: usize = 142;
const ACCESS_ASK: usize = 110;
const ACCESS_VIEW: usize = 111;
const ACCESS_CONTROL: usize = 112;
const TRAY_SHOW: usize = 201;
const TRAY_STOP: usize = 202;
const TRAY_QUIT: usize = 203;
const TRAY_MESSAGE: u32 = WM_APP + 1;
use beacon_remote_agent::support::DEFAULT_SERVER;
// Static text controls, identified so each can take its colour from the design.
const H_HEADING: i32 = 301;
const H_SECTION: i32 = 302;
const H_NAME: i32 = 303;
const H_INFO: i32 = 304;
const H_LABEL: i32 = 305;
const H_STATUS: i32 = 306;
const H_INTRO: i32 = 307;
const PAIRED_HEIGHT: i32 = 592;
const UNPAIRED_HEIGHT: i32 = 436;

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
    incoming_seen: u64,
    taskbar_created: u32,
    access: LocalAccess,
    radios: [HWND; 3],
    helper_radios: [HWND; 3],
    update_button: HWND,
    update_offer: Option<UpdateOffer>,
    update_check: Option<JoinHandle<Result<Option<UpdateOffer>, HostError>>>,
    update_install: Option<JoinHandle<Result<(), HostError>>>,
    helpers_job: Option<(JoinHandle<Result<(), HostError>>, u8)>,
    autostart: HWND,
    support: [HWND; 2],
    support_job: Option<JoinHandle<Result<SupportCode, HostError>>>,
    access_job: Option<(JoinHandle<Result<(), HostError>>, LocalAccess)>,
    // Presentation (ADR 0029).
    window: HWND,
    palette: ui::Palette,
    scale: f32,
    hot: i32,
    autostart_on: bool,
    files: HWND,
    pill_key: u8,
    fonts: Vec<HFONT>,
}
// Starting at sign-in is a visible, per-user choice made here. No service or elevation is involved.
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE: &str = "BeaconRemoteHost";
fn autostart_command() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    Some(format!("\"{}\" --background", exe.display()))
}
fn autostart_enabled() -> bool {
    unsafe {
        let mut key = null_mut();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            wide(RUN_KEY).as_ptr(),
            0,
            KEY_QUERY_VALUE,
            &mut key,
        ) != 0
        {
            return false;
        }
        let mut size = 0u32;
        let found = RegQueryValueExW(
            key,
            wide(RUN_VALUE).as_ptr(),
            null(),
            null_mut(),
            null_mut(),
            &mut size,
        ) == 0;
        let mut buffer = vec![0u16; (size as usize / 2).max(1)];
        let mut length = (buffer.len() * 2) as u32;
        let read = found
            && RegQueryValueExW(
                key,
                wide(RUN_VALUE).as_ptr(),
                null(),
                null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut length,
            ) == 0;
        RegCloseKey(key);
        let value = String::from_utf16_lossy(&buffer[..(length as usize / 2).min(buffer.len())]);
        read && Some(value.trim_end_matches('\0').to_string()) == autostart_command()
    }
}
fn set_autostart(enabled: bool) -> bool {
    unsafe {
        let mut key = null_mut();
        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            wide(RUN_KEY).as_ptr(),
            0,
            null(),
            0,
            KEY_SET_VALUE,
            null(),
            &mut key,
            null_mut(),
        ) != 0
        {
            return false;
        }
        let ok = if enabled {
            match autostart_command() {
                Some(command) => {
                    let value = wide(&command);
                    RegSetValueExW(
                        key,
                        wide(RUN_VALUE).as_ptr(),
                        0,
                        REG_SZ,
                        value.as_ptr().cast(),
                        (value.len() * 2) as u32,
                    ) == 0
                }
                None => false,
            }
        } else {
            let result = RegDeleteValueW(key, wide(RUN_VALUE).as_ptr());
            result == 0 || result == ERROR_FILE_NOT_FOUND
        };
        RegCloseKey(key);
        ok
    }
}
fn access_choice(access: LocalAccess) -> usize {
    match (access.trusted, access.allow_control) {
        (false, _) => 0,
        (true, false) => 1,
        (true, true) => 2,
    }
}
unsafe fn tray_data(window: HWND, status: &str) -> NOTIFYICONDATAW {
    let mut data = NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: window,
        uID: 1,
        uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP,
        uCallbackMessage: TRAY_MESSAGE,
        hIcon: LoadIconW(GetModuleHandleW(null()), 1 as _),
        ..Default::default()
    };
    for (target, source) in data.szTip.iter_mut().take(127).zip(status.encode_utf16()) {
        *target = source;
    }
    data
}
/// One Windows notification from the tray icon. Quiet time (Focus Assist) is respected; the consent window is
/// the real request, so a suppressed notification loses nothing.
unsafe fn tray_notice(window: HWND, title: &str, text: &str) {
    let mut data = NOTIFYICONDATAW {
        cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: window,
        uID: 1,
        uFlags: NIF_INFO,
        dwInfoFlags: NIIF_INFO | NIIF_RESPECT_QUIET_TIME,
        ..Default::default()
    };
    for (target, source) in data
        .szInfoTitle
        .iter_mut()
        .take(63)
        .zip(title.encode_utf16())
    {
        *target = source;
    }
    for (target, source) in data.szInfo.iter_mut().take(255).zip(text.encode_utf16()) {
        *target = source;
    }
    Shell_NotifyIconW(NIM_MODIFY, &data);
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
    // Text sits transparently on the painted window, so the area behind it is repainted.
    let parent = GetParent(window);
    if !parent.is_null() {
        let mut area = RECT::default();
        GetWindowRect(window, &mut area);
        MapWindowPoints(null_mut(), parent, std::ptr::addr_of_mut!(area).cast(), 2);
        InvalidateRect(parent, &area, 1);
    }
}
/// Centres the window in the usable screen area, so none of it sits under the taskbar.
unsafe fn place(window: HWND) {
    let mut work = RECT::default();
    SystemParametersInfoW(SPI_GETWORKAREA, 0, std::ptr::addr_of_mut!(work).cast(), 0);
    let mut area = RECT::default();
    GetWindowRect(window, &mut area);
    let (width, height) = (area.right - area.left, area.bottom - area.top);
    let x = work.left + (work.right - work.left - width) / 2;
    let y = (work.top + (work.bottom - work.top - height) / 2).max(work.top);
    SetWindowPos(
        window,
        null_mut(),
        x,
        y,
        0,
        0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
}
fn windows_name() -> String {
    unsafe {
        let mut buffer = [0u16; 16];
        let mut size = std::mem::size_of_val(&buffer) as u32;
        let ok = RegGetValueW(
            HKEY_LOCAL_MACHINE,
            wide("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion").as_ptr(),
            wide("CurrentBuildNumber").as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        ) == 0;
        let build = String::from_utf16_lossy(&buffer)
            .trim_end_matches('\0')
            .parse::<u32>()
            .unwrap_or(0);
        if ok && build >= 22000 {
            "Windows 11".into()
        } else {
            "Windows".into()
        }
    }
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
    // 0 not paired, 1 stopped, 2 starting, 3 online, 4 trouble.
    fn pill_mode(&self) -> u8 {
        if !self.paired {
            return 0;
        }
        match (&self.worker, self.last_status) {
            (None, _) => 1,
            (Some(_), Some(HostStatus::Online)) => 3,
            (Some(_), Some(HostStatus::Retrying | HostStatus::Rejected)) => 4,
            (Some(_), Some(HostStatus::Stopped | HostStatus::Removed)) => 1,
            (Some(_), _) => 2,
        }
    }
    unsafe fn track_hover(&mut self, window: HWND) {
        let mut point = POINT::default();
        GetCursorPos(&mut point);
        ScreenToClient(window, &mut point);
        let over = ChildWindowFromPoint(window, point);
        let id = if over.is_null() || over == window {
            0
        } else {
            GetDlgCtrlID(over)
        };
        if id != self.hot {
            let before = self.hot;
            self.hot = id;
            for changed in [before, id] {
                if changed != 0 {
                    InvalidateRect(GetDlgItem(window, changed), null(), 0);
                }
            }
        }
    }
    unsafe fn show_access(&self) {
        let chosen = access_choice(self.access);
        let _ = chosen;
        // Sending files without asking only makes sense once trusted access is on.
        if !self.files.is_null() {
            EnableWindow(
                self.files,
                i32::from(self.access.trusted && self.access_job.is_none() && !self.closing),
            );
            InvalidateRect(self.files, null(), 0);
        }
        for &radio in &self.radios {
            InvalidateRect(radio, null(), 0);
            EnableWindow(radio, i32::from(self.access_job.is_none() && !self.closing));
        }
    }
    // Trusted access can only be raised here, on the computer, after an explicit confirmation.
    unsafe fn choose_access(&mut self, window: HWND, choice: usize) {
        if self.access_job.is_some() || self.closing || choice == access_choice(self.access) {
            return;
        }
        let target = LocalAccess {
            trusted: choice > 0,
            allow_control: choice == 2,
            helpers: self.access.helpers,
            files: choice > 0 && self.access.files,
        };
        let raising = choice > access_choice(self.access);
        if raising {
            let message = if target.allow_control {
                "Let your signed-in Beacon Remote account view and control this computer without asking each time?\r\n\r\nThe sharing indicator stays visible and you can Stop at any time. You can turn this off here or from your workspace."
            } else {
                "Let your signed-in Beacon Remote account view this computer without asking each time?\r\n\r\nThe sharing indicator stays visible and you can Stop at any time. Controlling this computer will still ask. You can turn this off here or from your workspace."
            };
            if MessageBoxW(
                window,
                wide(message).as_ptr(),
                wide("Turn on trusted access").as_ptr(),
                MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2,
            ) != IDYES
            {
                self.show_access();
                return;
            }
        }
        text(self.status, "Updating trusted access…");
        let handle = thread::spawn(move || {
            beacon_remote_agent::set_access(target.trusted, target.allow_control)
        });
        self.access_job = Some((handle, target));
        self.show_access();
    }
    unsafe fn show_helpers(&self) {
        for &radio in &self.helper_radios {
            InvalidateRect(radio, null(), 0);
            EnableWindow(
                radio,
                i32::from(self.helpers_job.is_none() && !self.closing),
            );
        }
    }
    // Remembered helpers skip the Allow only if this computer says so, after a confirmation.
    unsafe fn choose_helpers(&mut self, window: HWND, level: u8) {
        if self.helpers_job.is_some() || self.closing || level == self.access.helpers {
            return;
        }
        if level > self.access.helpers {
            let message = if level == 2 {
                "Let people you chose to remember (in your workspace, under Support access) view and control this computer without asking each time?\r\n\r\nThe sharing indicator stays visible, you can Stop at any time, and you can turn this off here or from your workspace."
            } else {
                "Let people you chose to remember (in your workspace, under Support access) view this computer without asking each time?\r\n\r\nControlling it will still ask. The sharing indicator stays visible and you can Stop at any time."
            };
            if MessageBoxW(
                window,
                wide(message).as_ptr(),
                wide("Remembered helpers without asking").as_ptr(),
                MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2,
            ) != IDYES
            {
                self.show_helpers();
                return;
            }
        }
        text(self.status, "Updating remembered helpers…");
        self.helpers_job = Some((
            thread::spawn(move || beacon_remote_agent::set_helpers(level)),
            level,
        ));
        self.show_helpers();
    }
    // Updates are signed by the Beacon Remote update key and only ever installed when asked for.
    unsafe fn update_clicked(&mut self, window: HWND) {
        if self.update_check.is_some() || self.update_install.is_some() || self.closing {
            return;
        }
        let Some(offer) = &self.update_offer else {
            text(self.status, "Checking for updates…");
            self.update_check = Some(thread::spawn(beacon_remote_agent::check_for_update));
            EnableWindow(self.update_button, 0);
            return;
        };
        let message = format!(
            "Install {}?

Beacon Remote will close and start again. Any sharing stops while it updates, and the previous version is kept in case it needs to be put back.",
            offer.version()
        );
        if MessageBoxW(
            window,
            wide(&message).as_ptr(),
            wide("Install update").as_ptr(),
            MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2,
        ) != IDYES
        {
            return;
        }
        text(self.status, "Downloading and checking the update…");
        let offer = self.update_offer.take().unwrap();
        self.update_install = Some(thread::spawn(move || {
            beacon_remote_agent::install_update(&offer)
        }));
        EnableWindow(self.update_button, 0);
    }
    unsafe fn ask_support(&mut self, control: bool) {
        if self.support_job.is_some() || self.closing || !self.paired {
            return;
        }
        text(self.status, "Requesting a support code…");
        self.support_job = Some(thread::spawn(move || {
            beacon_remote_agent::request_support_code(control)
        }));
        for &button in &self.support {
            EnableWindow(button, 0);
        }
    }
    unsafe fn controls(&self) {
        text(
            self.introduction,
            "Pair this computer with your workspace. Screen viewing and control require visible local approval.",
        );
        ShowWindow(
            self.introduction,
            if self.paired { SW_HIDE } else { SW_SHOW },
        );
        let px = |value: i32| (value as f32 * self.scale).round() as i32;
        MoveWindow(
            self.status,
            px(28),
            px(if self.paired { 58 } else { 372 }),
            px(464),
            px(if self.paired { 40 } else { 44 }),
            1,
        );
        MoveWindow(
            self.action,
            px(28),
            px(if self.paired { 498 } else { 322 }),
            px(if self.paired { 120 } else { 160 }),
            px(38),
            1,
        );
        MoveWindow(self.stop, px(160), px(498), px(110), px(38), 1);
        // The window is as tall as its current view needs.
        let mut bounds = RECT {
            left: 0,
            top: 0,
            right: px(520),
            bottom: px(if self.paired {
                PAIRED_HEIGHT
            } else {
                UNPAIRED_HEIGHT
            }),
        };
        AdjustWindowRectEx(
            &mut bounds,
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
            0,
            0,
        );
        SetWindowPos(
            self.window,
            null_mut(),
            0,
            0,
            bounds.right - bounds.left,
            bounds.bottom - bounds.top,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
        place(self.window);
        InvalidateRect(self.window, null(), 1);
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
        InvalidateRect(self.action, null(), 0);
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
                        HostStatus::Removed => "Removed · Your account owner removed this computer. Beacon Remote is uninstalling.",
                    });
                }
            }
        }
        if self
            .support_job
            .as_ref()
            .is_some_and(|job| job.is_finished())
        {
            let job = self.support_job.take().unwrap();
            match job.join() {
                Ok(Ok(support)) => text(
                    self.status,
                    &format!(
                        "Support code {} · Works once, expires in {} minutes. You still approve the connection here.",
                        support.code,
                        support.expires_in.as_secs() / 60
                    ),
                ),
                _ => text(
                    self.status,
                    "Could not get a support code. Check your network and try again.",
                ),
            }
            for &button in &self.support {
                EnableWindow(button, i32::from(!self.closing));
            }
        }
        if self
            .update_check
            .as_ref()
            .is_some_and(|job| job.is_finished())
        {
            match self.update_check.take().unwrap().join() {
                Ok(Ok(Some(offer))) => {
                    text(
                        self.status,
                        &format!("{} is available. Select Install update.", offer.version()),
                    );
                    text(self.update_button, "Install update");
                    self.update_offer = Some(offer);
                }
                Ok(Ok(None)) => text(self.status, "This host is up to date."),
                _ => text(
                    self.status,
                    "Could not check for updates. Check your network and try again.",
                ),
            }
            EnableWindow(self.update_button, i32::from(!self.closing));
        }
        if self
            .update_install
            .as_ref()
            .is_some_and(|job| job.is_finished())
        {
            if matches!(self.update_install.take().unwrap().join(), Ok(Ok(()))) {
                // The updater waits for this process to exit, then swaps the files and restarts.
                self.closing = true;
                PostMessageW(window, WM_CLOSE, 0, 0);
            } else {
                text(
                    self.status,
                    "The update could not be installed. Nothing was changed.",
                );
                text(self.update_button, "Check for updates");
                EnableWindow(self.update_button, i32::from(!self.closing));
            }
        }
        if self
            .helpers_job
            .as_ref()
            .is_some_and(|(job, _)| job.is_finished())
        {
            let (job, level) = self.helpers_job.take().unwrap();
            if matches!(job.join(), Ok(Ok(()))) {
                self.access.helpers = level;
                text(self.status, "Remembered helpers updated.");
            } else {
                self.access = beacon_remote_agent::local_access();
                text(
                    self.status,
                    "Could not change remembered helpers. Check your network and try again.",
                );
            }
            self.show_helpers();
        }
        if self
            .access_job
            .as_ref()
            .is_some_and(|(job, _)| job.is_finished())
        {
            let (job, target) = self.access_job.take().unwrap();
            if matches!(job.join(), Ok(Ok(()))) {
                self.access = target;
                text(self.status, "Trusted access updated.");
            } else {
                self.access = beacon_remote_agent::local_access();
                text(
                    self.status,
                    "Could not change trusted access. Check your network and try again.",
                );
            }
            self.show_access();
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
        let key = self.pill_mode();
        if key != self.pill_key {
            self.pill_key = key;
            InvalidateRect(window, null(), 0);
        }
        self.track_hover(window);
        if self.closing && self.worker.is_none() {
            DestroyWindow(window);
        } else if self.tray {
            let status = format!("Beacon Remote · {}", read(self.status));
            if self.tray_status != status {
                Shell_NotifyIconW(NIM_MODIFY, &tray_data(window, &status));
                self.tray_status = status;
            }
            if let Some(request) = beacon_remote_agent::incoming::next(&mut self.incoming_seen) {
                let (title, text) = beacon_remote_agent::incoming::notice(&request);
                tray_notice(window, &title, &text);
            }
        }
    }
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
    if let Some(canvas) = ui::Canvas::new(buffer, state.scale) {
        let (label, fill, line, ink) = match state.pill_mode() {
            0 => ("Not paired", p.warn_soft, p.warn_line, p.warn),
            1 => ("Stopped", p.subtle, p.line, p.muted),
            2 => ("Starting", p.accent_soft, p.accent, p.accent),
            3 => ("Online", p.success_soft, p.success, p.success),
            _ => ("Needs attention", p.danger_soft, p.danger, p.danger),
        };
        let pill_width = if state.pill_mode() == 4 { 124.0 } else { 100.0 };
        ui::pill(
            &canvas,
            (492.0 - pill_width, 26.0, pill_width, 26.0),
            label,
            fill,
            line,
            ink,
        );
        if state.paired {
            canvas.fill(28.0, 104.0, 464.0, 84.0, 10.0, p.subtle);
            canvas.stroke(28.0, 104.0, 464.0, 84.0, 10.0, p.line, 1.0);
            ui::icon(&canvas, ui::Icon::Monitor, 44.0, 142.0, p.accent);
            ui::icon(&canvas, ui::Icon::Lock, 44.0, 166.0, p.accent);
            canvas.line(28.0, 424.0, 492.0, 424.0, p.line, 1.0);
        } else {
            for top in [124.0, 192.0, 260.0] {
                canvas.fill(28.0, top, 464.0, 34.0, 8.0, p.surface);
                canvas.stroke(28.0, top, 464.0, 34.0, 8.0, p.line, 1.0);
            }
        }
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
    let p = &state.palette;
    let brush = CreateSolidBrush(ui::colorref(p.window));
    FillRect(item.hDC, &item.rcItem, brush);
    DeleteObject(brush);
    let Some(canvas) = ui::Canvas::new(item.hDC, state.scale) else {
        return;
    };
    let id = item.CtlID as usize;
    let mut label = [0u16; 128];
    let length = GetWindowTextW(item.hwndItem, label.as_mut_ptr(), label.len() as i32).max(0);
    let label = String::from_utf16_lossy(&label[..length as usize]);
    let flags = ui::State {
        hot: state.hot == id as i32,
        pressed: item.itemState & ODS_SELECTED != 0,
        focused: item.itemState & ODS_FOCUS != 0,
        disabled: item.itemState & ODS_DISABLED != 0,
    };
    let choice = access_choice(state.access);
    let selected = match id {
        ACCESS_ASK => Some(choice == 0),
        ACCESS_VIEW => Some(choice == 1),
        ACCESS_CONTROL => Some(choice == 2),
        HELPERS_OFF => Some(state.access.helpers == 0),
        HELPERS_VIEW => Some(state.access.helpers == 1),
        HELPERS_CONTROL => Some(state.access.helpers == 2),
        _ => None,
    };
    if let Some(selected) = selected {
        // A radio row: the ring, the dot when chosen, and the label.
        let ink = if flags.disabled { p.faint } else { p.text };
        let ring = if selected { p.accent } else { p.faint };
        canvas.ring(11.0, h / 2.0, 8.0, ring, 1.6);
        if selected {
            canvas.circle(
                11.0,
                h / 2.0,
                4.0,
                if flags.disabled { p.faint } else { p.accent },
            );
        }
        canvas.text(
            &label,
            (30.0, 0.0, w - 30.0, h),
            13.5,
            if selected { 600 } else { 400 },
            ink,
            ui::Align::Left,
            true,
        );
        if flags.focused {
            canvas.stroke(0.0, 0.0, w, h, 6.0, p.accent, 2.0);
        }
    } else if id == AUTOSTART || id == FILES {
        let on = if id == FILES {
            state.access.files
        } else {
            state.autostart_on
        };
        let ink = if flags.disabled { p.faint } else { p.text };
        let top = (h - 18.0) / 2.0;
        if on {
            canvas.fill(2.0, top, 18.0, 18.0, 5.0, p.accent);
            canvas.line(6.5, top + 9.5, 9.5, top + 12.5, p.on_accent, 2.0);
            canvas.line(9.5, top + 12.5, 15.0, top + 6.0, p.on_accent, 2.0);
        } else {
            canvas.stroke(2.0, top, 18.0, 18.0, 5.0, p.faint, 1.6);
        }
        canvas.text(
            &label,
            (30.0, 0.0, w - 30.0, h),
            13.5,
            400,
            ink,
            ui::Align::Left,
            true,
        );
        if flags.focused {
            canvas.stroke(0.0, 0.0, w, h, 6.0, p.accent, 2.0);
        }
    } else {
        let role = if id == ACTION {
            ui::Role::Primary
        } else {
            ui::Role::Secondary
        };
        ui::button(&canvas, p, (w, h), &label, role, flags);
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
        WM_ERASEBKGND if !state.is_null() => return 1,
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
                H_HEADING | H_NAME | H_SECTION | H_LABEL => p.strong,
                H_STATUS | H_INTRO | H_INFO => p.muted,
                _ => p.text,
            };
            SetTextColor(wparam as _, ui::colorref(color));
            SetBkMode(wparam as _, TRANSPARENT as i32);
            return GetStockObject(NULL_BRUSH) as isize;
        }
        WM_CTLCOLOREDIT if !state.is_null() => {
            let p = &(*state).palette;
            SetTextColor(wparam as _, ui::colorref(p.strong));
            SetBkColor(wparam as _, ui::colorref(p.surface));
            return ui::surface_brush(p.surface) as isize;
        }
        WM_COMMAND if !state.is_null() && (wparam >> 16) == BN_CLICKED as usize => {
            match wparam & 0xffff {
                ACTION => (*state).start(),
                STOP => (*state).stop(),
                AUTOSTART => {
                    let wanted = !(*state).autostart_on;
                    if set_autostart(wanted) {
                        (*state).autostart_on = wanted;
                    } else {
                        text((*state).status, "Could not change start at sign-in.");
                    }
                    InvalidateRect((*state).autostart, null(), 0);
                }
                FILES => {
                    let wanted = !(*state).access.files;
                    if beacon_remote_agent::set_files(wanted).is_ok() {
                        (*state).access = beacon_remote_agent::local_access();
                    } else {
                        text((*state).status, "Could not change file transfer.");
                    }
                    InvalidateRect((*state).files, null(), 0);
                }
                SUPPORT_VIEW => (*state).ask_support(false),
                SUPPORT_CONTROL => (*state).ask_support(true),
                UPDATE => (*state).update_clicked(window),
                HELPERS_OFF => (*state).choose_helpers(window, 0),
                HELPERS_VIEW => (*state).choose_helpers(window, 1),
                HELPERS_CONTROL => (*state).choose_helpers(window, 2),
                ACCESS_ASK => (*state).choose_access(window, 0),
                ACCESS_VIEW => (*state).choose_access(window, 1),
                ACCESS_CONTROL => (*state).choose_access(window, 2),
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

pub fn show(background: bool) -> Result<(), io::Error> {
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
        let factor = GetDpiForSystem().max(96) as f32 / 96.0;
        let scale = move |value: i32| (value as f32 * factor).round() as i32;
        let instance = GetModuleHandleW(null());
        let class = wide("BeaconRemoteHostWindow");
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
        let paired = beacon_remote_agent::is_paired();
        let mut state = State {
            paired,
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
            incoming_seen: beacon_remote_agent::incoming::mark(),
            taskbar_created: RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()),
            access: beacon_remote_agent::local_access(),
            radios: [null_mut(); 3],
            helper_radios: [null_mut(); 3],
            update_button: null_mut(),
            update_offer: None,
            update_check: None,
            update_install: None,
            helpers_job: None,
            autostart: null_mut(),
            support: [null_mut(); 2],
            support_job: None,
            access_job: None,
            window: null_mut(),
            palette: ui::palette(),
            scale: factor,
            hot: 0,
            autostart_on: autostart_enabled(),
            files: null_mut(),
            pill_key: 255,
            fonts: Vec::new(),
        };
        let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
        let mut bounds = RECT {
            left: 0,
            top: 0,
            right: scale(520),
            bottom: scale(if paired {
                PAIRED_HEIGHT
            } else {
                UNPAIRED_HEIGHT
            }),
        };
        AdjustWindowRectEx(&mut bounds, style, 0, 0);
        let window = CreateWindowExW(
            0,
            class.as_ptr(),
            wide("Beacon Remote").as_ptr(),
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
        let child = |class: &str,
                     label: &str,
                     x: i32,
                     y: i32,
                     width: i32,
                     height: i32,
                     extra: u32,
                     id: usize|
         -> Result<HWND, io::Error> {
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
            Ok(control)
        };
        let owner_draw = WS_TABSTOP | BS_OWNERDRAW as u32;
        let computer = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "this computer".into());
        let build = (|| -> Result<(), io::Error> {
            let heading = child(
                "STATIC",
                if paired {
                    "This computer"
                } else {
                    "Set up this computer"
                },
                28,
                22,
                340,
                32,
                SS_NOPREFIX,
                H_HEADING as usize,
            )?;
            state.introduction =
                child("STATIC", "", 28, 58, 464, 40, SS_NOPREFIX, H_INTRO as usize)?;
            state.status = child(
                "STATIC",
                if paired {
                    "Computer paired. Select Start host to make it available."
                } else {
                    "Not paired. Generate a code in your signed-in workspace."
                },
                28,
                if paired { 58 } else { 372 },
                464,
                if paired { 40 } else { 44 },
                SS_NOPREFIX,
                H_STATUS as usize,
            )?;
            // Enrollment: three fields, each on a card drawn behind it.
            for (label, top) in [
                ("Server", 100),
                ("Computer name", 168),
                ("Pairing code from your workspace", 236),
            ] {
                state.enrollment.push(child(
                    "STATIC",
                    label,
                    28,
                    top,
                    464,
                    20,
                    SS_NOPREFIX,
                    H_LABEL as usize,
                )?);
            }
            let field = WS_TABSTOP | ES_AUTOHSCROLL as u32;
            state.server = child("EDIT", DEFAULT_SERVER, 40, 130, 440, 22, field, SERVER)?;
            state.name = child("EDIT", &computer, 40, 198, 440, 22, field, NAME)?;
            state.code = child(
                "EDIT",
                "",
                40,
                266,
                440,
                22,
                field | ES_PASSWORD as u32,
                CODE,
            )?;
            SendMessageW(state.server, EM_SETLIMITTEXT, 2048, 0);
            SendMessageW(state.name, EM_SETLIMITTEXT, 80, 0);
            SendMessageW(state.code, EM_SETLIMITTEXT, 256, 0);
            state
                .enrollment
                .extend([state.server, state.name, state.code]);

            // Paired: the computer, then the two access choices, then the actions.
            let name_line = child(
                "STATIC",
                &computer,
                44,
                114,
                300,
                22,
                SS_NOPREFIX,
                H_NAME as usize,
            )?;
            let info_one = child(
                "STATIC",
                &format!(
                    "{} · Beacon Remote host {}",
                    windows_name(),
                    env!("CARGO_PKG_VERSION")
                ),
                70,
                140,
                410,
                20,
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            let info_two = child(
                "STATIC",
                &format!(
                    "Paired to {}",
                    beacon_remote_agent::paired_server().unwrap_or_else(|| "your workspace".into())
                ),
                70,
                164,
                410,
                20,
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            let section_trust = child(
                "STATIC",
                "Connect to this computer without asking (your own account)",
                28,
                206,
                464,
                22,
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            let section_helpers = child(
                "STATIC",
                "Remembered helpers (people you added in your workspace)",
                28,
                308,
                464,
                22,
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            state.paired_details.extend([
                name_line,
                info_one,
                info_two,
                section_trust,
                section_helpers,
            ]);
            for (index, (label, id)) in [
                ("Ask me every time", ACCESS_ASK),
                ("View without asking", ACCESS_VIEW),
                ("View and control without asking", ACCESS_CONTROL),
            ]
            .into_iter()
            .enumerate()
            {
                let radio = child(
                    "BUTTON",
                    label,
                    28,
                    232 + 26 * index as i32,
                    464,
                    24,
                    owner_draw,
                    id,
                )?;
                state.radios[index] = radio;
                state.paired_details.push(radio);
            }
            for (index, (label, id)) in [
                ("Ask me every time", HELPERS_OFF),
                ("They can view without asking", HELPERS_VIEW),
                ("They can view and control without asking", HELPERS_CONTROL),
            ]
            .into_iter()
            .enumerate()
            {
                let radio = child(
                    "BUTTON",
                    label,
                    28,
                    334 + 26 * index as i32,
                    464,
                    24,
                    owner_draw,
                    id,
                )?;
                state.helper_radios[index] = radio;
                state.paired_details.push(radio);
            }
            state.autostart = child(
                "BUTTON",
                "Start Beacon Remote when I sign in to Windows",
                28,
                434,
                464,
                24,
                owner_draw,
                AUTOSTART,
            )?;
            state.paired_details.push(state.autostart);
            state.files = child(
                "BUTTON",
                "Also let my account send files to this computer",
                28,
                460,
                464,
                24,
                owner_draw,
                FILES,
            )?;
            state.paired_details.push(state.files);
            state.action = child(
                "BUTTON",
                "Pair computer",
                28,
                if paired { 498 } else { 322 },
                if paired { 120 } else { 160 },
                38,
                owner_draw | WS_VISIBLE,
                ACTION,
            )?;
            state.stop = child("BUTTON", "Stop host", 160, 498, 110, 38, owner_draw, STOP)?;
            state.update_button = child(
                "BUTTON",
                "Check for updates",
                282,
                498,
                170,
                38,
                owner_draw,
                UPDATE,
            )?;
            state.paired_details.push(state.update_button);
            for (index, (label, id, x, width)) in [
                ("Support code: view only", SUPPORT_VIEW, 28, 236),
                ("Support code: view and control", SUPPORT_CONTROL, 276, 216),
            ]
            .into_iter()
            .enumerate()
            {
                let button = child("BUTTON", label, x, 546, width, 38, owner_draw, id)?;
                state.support[index] = button;
                state.paired_details.push(button);
            }

            // Fonts: semibold headings, regular body.
            let font = |height: i32, weight: i32| ui::gdi_font(scale(height), weight);
            let (heading_font, strong, label_font, body, edit_font) = (
                font(23, 600),
                font(14, 600),
                font(13, 600),
                font(13, 400),
                font(15, 400),
            );
            state.fonts = vec![heading_font, strong, label_font, body, edit_font];
            let set = |handle: HWND, f: HFONT| {
                SendMessageW(handle, WM_SETFONT, f as usize, 1);
            };
            set(heading, heading_font);
            set(name_line, strong);
            set(section_trust, strong);
            set(section_helpers, strong);
            for &label in state.enrollment.iter().take(3) {
                set(label, label_font);
            }
            for handle in [state.introduction, state.status, info_one, info_two] {
                set(handle, body);
            }
            for handle in [state.server, state.name, state.code] {
                set(handle, edit_font);
            }
            state.controls();
            state.show_access();
            state.show_helpers();
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
        place(window);
        // Started at sign-in: go straight to the tray and bring the host online. The owner chose
        // this above, and the tray icon and sharing indicator stay visible.
        if background && state.paired && state.tray {
            ShowWindow(window, SW_HIDE);
            state.start();
        } else {
            ShowWindow(window, SW_SHOW);
        }
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
        for font in state.fonts.drain(..) {
            ui::delete_font(font);
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
