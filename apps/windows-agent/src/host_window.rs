//! Interactive host enrollment and presence. Closing waits for the worker to release sharing.
use beacon_remote_agent::native_ui as ui;

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
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
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
        Controls::{
            DRAWITEMSTRUCT, EM_SETLIMITTEXT, EM_SETREADONLY, EM_SETSEL, ODS_DISABLED, ODS_FOCUS,
            ODS_SELECTED,
        },
        HiDpi::{
            GetDpiForSystem, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE,
        },
        Input::KeyboardAndMouse::{EnableWindow, SetFocus},
        Shell::*,
        WindowsAndMessaging::*,
    },
};
use zeroize::Zeroize;

const ACTION: usize = 101;
const SERVER: usize = 103;
const NAME: usize = 104;
const CODE: usize = 105;
/// "Change" beside the server address, which is read-only until it is pressed (review R11).
const SERVER_CHANGE: usize = 106;
const AUTOSTART: usize = 120;
const FILES: usize = 121;
const BOOT_START: usize = 122;
const UPDATE: usize = 150;
const UNATTENDED: usize = 151;
const UNATTENDED_OFF: usize = 152;
const SIGNIN_SETTINGS: usize = 153;
const TAB_HOME: usize = 170;
const TAB_ACCESS: usize = 171;
const TAB_UNATTENDED: usize = 172;
const TAB_SUPPORT: usize = 173;
const TABS: [(usize, &str); 4] = [
    (TAB_HOME, "Home"),
    (TAB_ACCESS, "Access"),
    (TAB_UNATTENDED, "Unattended"),
    (TAB_SUPPORT, "Support"),
];
const SUPPORT_VIEW: usize = 130;
const SUPPORT_CONTROL: usize = 131;
const HELPERS_OFF: usize = 140;
const HELPERS_VIEW: usize = 141;
const HELPERS_CONTROL: usize = 142;
// What a viewer may do with the clipboard (ADR 0060): off, button only or automatic.
const CLIP_OFF: usize = 160;
const CLIP_BUTTON: usize = 161;
const CLIP_AUTO: usize = 162;
const ACCESS_ASK: usize = 110;
const ACCESS_VIEW: usize = 111;
const ACCESS_CONTROL: usize = 112;
const TRAY_SHOW: usize = 201;
const TRAY_STOP: usize = 202;
const TRAY_QUIT: usize = 203;
const TRAY_LOCK_ON_END: usize = 204;
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
// One size per state: a paired computer's tabs share a height so the window never jumps between them.
const PAIRED_HEIGHT: i32 = 600;
const UNPAIRED_HEIGHT: i32 = 436;
/// A control that belongs to some tabs of the paired view, at a fixed place (logical pixels).
struct Member {
    window: HWND,
    tabs: u8,
    rect: (i32, i32, i32, i32),
}

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
    status: HWND,
    introduction: HWND,
    /// "Set up this computer" until pairing, then "This computer" (updated in place, not on reopen).
    heading: HWND,
    last_status: Option<HostStatus>,
    enrollment: Vec<HWND>,
    members: Vec<Member>,
    tab: u8,
    access_help: HWND,
    helper_help: HWND,
    unattended_status: HWND,
    version_line: HWND,
    summary: [HWND; 3],
    tray: bool,
    tray_status: String,
    incoming_seen: u64,
    taskbar_created: u32,
    access: LocalAccess,
    radios: [HWND; 3],
    helper_radios: [HWND; 3],
    clip_radios: [HWND; 3],
    clip_help: HWND,
    clip_mode: u8,
    update_button: HWND,
    update_offer: Option<UpdateOffer>,
    update_check: Option<JoinHandle<Result<Option<UpdateOffer>, HostError>>>,
    update_install: Option<JoinHandle<Result<(), HostError>>>,
    signin_check: Option<JoinHandle<Result<Option<bool>, HostError>>>,
    /// Whether this run already brought the "finish the update" step forward (review R13): once per run.
    repair_offered: bool,
    /// Whether the session page currently open saw an actual session (not only a request that was declined or
    /// expired): only then may "lock when a remote session ends" lock Windows.
    session_ran: bool,
    signin_health: Option<bool>,
    signin_recheck: bool,
    helpers_job: Option<(JoinHandle<Result<(), HostError>>, u8)>,
    autostart: HWND,
    support: [HWND; 2],
    support_job: Option<JoinHandle<Result<SupportCode, HostError>>>,
    access_job: Option<(JoinHandle<Result<(), HostError>>, LocalAccess)>,
    unattended_job: Option<JoinHandle<Result<(), HostError>>>,
    start_after_setup: bool,
    // Presentation (ADR 0029).
    window: HWND,
    palette: ui::Palette,
    scale: f32,
    hot: i32,
    autostart_on: bool,
    boot_start: HWND,
    boot_on: Option<bool>,
    files: HWND,
    pill_key: u8,
    fonts: Vec<HFONT>,
    // The Windows sign-in page, shown inside this window in place of the main view, and the controls it hides.
    signin_page: HWND,
    hidden_for_page: Vec<HWND>,
    // The request / sharing page (ADR 0059) and the controls it hides.
    session_page: HWND,
    hidden_for_session: Vec<HWND>,
    session_height: i32,
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
/// `WM_COPYDATA` tag for a pairing link handed to the window that is already open, and the longest link accepted.
const LINK_MESSAGE: usize = 0x4252_4C4B;
const MAX_LINK: usize = 2300;

/// A pairing link pasted into the code box (`beaconremote://pair?code=…&server=…`, as the workspace offers for phones):
/// the server it names, if any, and the code. `None` for anything else, including a plain code.
fn pairing_link(typed: &str) -> Option<(Option<String>, String)> {
    let url = reqwest::Url::parse(typed.trim()).ok()?;
    if url.scheme() != "beaconremote" || url.host_str() != Some("pair") {
        return None;
    }
    let mut code = None;
    let mut server = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" if !value.is_empty() && value.len() <= 64 => code = Some(value.into_owned()),
            "server" if !value.is_empty() && value.len() <= 2048 => {
                server = Some(value.into_owned())
            }
            _ => {}
        }
    }
    code.map(|code| (server, code))
}

/// What to tell the person when the pairing form is incomplete, naming the first box that needs filling in.
fn missing_field(server: &str, name: &str, code: &str) -> Option<&'static str> {
    if server.trim().is_empty() {
        Some("Enter the server address.")
    } else if name.trim().is_empty() {
        Some("Give this computer a name.")
    } else if code.trim().is_empty() {
        Some("Enter the pairing code from your workspace, like AB3K-9PQ2.")
    } else {
        None
    }
}
fn primary_label(paired: bool, busy: bool, stopping: bool) -> &'static str {
    match (paired, busy, stopping) {
        (_, true, true) => "Stopping…",
        (true, true, false) => "Stop host",
        (true, false, _) => "Start host",
        (false, true, false) => "Pairing…",
        (false, false, _) => "Pair computer",
    }
}

impl State {
    /// True when the paired view is showing this tab (and no other page covers it).
    fn on_tab(&self, tab: u8) -> bool {
        self.paired && self.tab == tab && self.signin_page.is_null() && self.session_page.is_null()
    }
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
        let settings_ready = self.access_job.is_none()
            && self.helpers_job.is_none()
            && self.unattended_job.is_none()
            && !self.closing;
        for id in [
            AUTOSTART,
            BOOT_START,
            UNATTENDED,
            UNATTENDED_OFF,
            SIGNIN_SETTINGS,
        ] {
            let control = GetDlgItem(self.window, id as i32);
            EnableWindow(control, i32::from(settings_ready));
            InvalidateRect(control, null(), 0);
        }
        // Keep the setup shortcut only while it can add something. Revocation
        // remains available even if a service's status could not be read.
        let configured = self.access.trusted
            && self.access.allow_control
            && self.access.files
            && self.autostart_on;
        let on_unattended = self.on_tab(2);
        ShowWindow(
            GetDlgItem(self.window, UNATTENDED as i32),
            if on_unattended && !configured {
                SW_SHOW
            } else {
                SW_HIDE
            },
        );
        ShowWindow(
            GetDlgItem(self.window, UNATTENDED_OFF as i32),
            if on_unattended
                && (self.access.trusted
                    || self.autostart_on
                    || self.boot_on != Some(false)
                    || self.signin_health.is_some())
            {
                SW_SHOW
            } else {
                SW_HIDE
            },
        );
        let px = |value: i32| (value as f32 * self.scale).round() as i32;
        MoveWindow(
            GetDlgItem(self.window, UNATTENDED_OFF as i32),
            px(28),
            px(if configured { 300 } else { 352 }),
            px(464),
            px(44),
            1,
        );
        text(
            self.unattended_status,
            &if configured {
                "On · your own account can view and control this computer without asking."
                    .to_owned()
            } else if self.access.trusted {
                "Partly on · finish setup to allow control and starting at sign-in.".to_owned()
            } else {
                "Off · every connection asks you first.".to_owned()
            },
        );
        let who = |level: u8| match level {
            0 => "Asks each time",
            1 => "Can view",
            _ => "Can view and control",
        };
        text(self.summary[0], who(access_choice(self.access) as u8));
        text(
            self.summary[2],
            if configured {
                "On"
            } else if self.access.trusted {
                "Partly on"
            } else {
                "Off"
            },
        );
        text(
            self.access_help,
            match access_choice(self.access) {
                0 => "You approve every connection from your own account, each time.",
                1 => "Your own account can see this screen without asking. Control still asks.",
                _ => "Your own account can see and control this computer without asking.",
            },
        );
        text(
            self.boot_start,
            if self.boot_on.is_some() {
                "Start boot status before Windows sign-in (admin setup)"
            } else {
                "Boot startup status unavailable · select to repair"
            },
        );
        // Sending files without asking only makes sense once trusted access is on.
        if !self.files.is_null() {
            ShowWindow(
                self.files,
                if self.on_tab(1) && self.access.trusted {
                    SW_SHOW
                } else {
                    SW_HIDE
                },
            );
            EnableWindow(
                self.files,
                i32::from(
                    self.access.trusted
                        && self.access_job.is_none()
                        && self.unattended_job.is_none()
                        && !self.closing,
                ),
            );
            InvalidateRect(self.files, null(), 0);
        }
        for &radio in &self.radios {
            InvalidateRect(radio, null(), 0);
            EnableWindow(
                radio,
                i32::from(
                    self.access_job.is_none() && self.unattended_job.is_none() && !self.closing,
                ),
            );
        }
    }
    // Trusted access can only be raised here, on the computer, after an explicit confirmation.
    unsafe fn choose_access(&mut self, _window: HWND, choice: usize) {
        if self.access_job.is_some()
            || self.unattended_job.is_some()
            || self.closing
            || choice == access_choice(self.access)
        {
            return;
        }
        let target = LocalAccess {
            trusted: choice > 0,
            allow_control: choice == 2,
            helpers: self.access.helpers,
            files: choice > 0 && self.access.files,
            lock_on_end: self.access.lock_on_end,
        };
        text(self.status, "Updating trusted access…");
        let handle = thread::spawn(move || {
            beacon_remote_agent::set_access(target.trusted, target.allow_control)
        });
        self.access_job = Some((handle, target));
        self.show_access();
    }
    unsafe fn setup_unattended(&mut self) {
        if self.unattended_job.is_some()
            || self.access_job.is_some()
            || self.helpers_job.is_some()
            || self.closing
        {
            return;
        }
        text(self.status, "Setting up unattended owner access…");
        self.start_after_setup = true;
        self.unattended_job = Some(thread::spawn(|| {
            // Boot startup is a separate optional setting. User-session access needs no service.
            if !set_autostart(true) {
                return Err("Could not enable start at sign-in".into());
            }
            beacon_remote_agent::set_access(true, true)?;
            beacon_remote_agent::set_files(true)
        }));
        self.show_access();
        self.show_helpers();
    }
    unsafe fn toggle_boot_start(&mut self) {
        if self.unattended_job.is_some()
            || self.access_job.is_some()
            || self.helpers_job.is_some()
            || self.closing
        {
            return;
        }
        let wanted = self.boot_on != Some(true);
        self.start_after_setup = false;
        text(
            self.status,
            "Updating boot startup · approve Windows administrator setup…",
        );
        self.unattended_job = Some(thread::spawn(move || {
            if wanted {
                beacon_remote_agent::availability::setup()
            } else {
                beacon_remote_agent::availability::remove()
            }
        }));
        self.show_access();
        self.show_helpers();
    }
    // What a viewer may do with the clipboard is the person's choice, kept in a small local file that the sharing
    // helper reads afresh, so a change applies to the session in progress.
    unsafe fn show_clipboard(&self) {
        let mut help = String::from(match self.clip_mode {
            0 => "Viewers cannot read or set this computer's clipboard.",
            1 => "Text moves only when a viewer presses a button. Setting it asks you first.",
            _ => "Copied text moves both ways while someone is connected.",
        });
        if let Some(ago) = last_clip_write_ago() {
            help.push_str(&format!("\r\nA viewer last set it {ago}."));
        }
        text(self.clip_help, &help);
        for &radio in &self.clip_radios {
            InvalidateRect(radio, null(), 0);
        }
    }
    unsafe fn choose_clipboard(&mut self, level: u8) {
        if self.closing || level == self.clip_mode {
            return;
        }
        if write_clip_mode(level) {
            self.clip_mode = level;
        } else {
            text(self.status, "Could not change the clipboard setting.");
        }
        self.show_clipboard();
    }
    unsafe fn show_helpers(&self) {
        text(
            self.summary[1],
            match self.access.helpers {
                0 => "Asks each time",
                1 => "Can view",
                _ => "Can view and control",
            },
        );
        text(
            self.helper_help,
            match self.access.helpers {
                0 => "People you remembered in your workspace must ask each time.",
                1 => "People you remembered can view without asking. Control still asks.",
                _ => "People you remembered can view and control without asking.",
            },
        );
        for &radio in &self.helper_radios {
            InvalidateRect(radio, null(), 0);
            EnableWindow(
                radio,
                i32::from(
                    self.helpers_job.is_none() && self.unattended_job.is_none() && !self.closing,
                ),
            );
        }
        self.show_clipboard();
    }
    // Remembered helpers skip the Allow only if this computer says so, after a confirmation.
    unsafe fn choose_helpers(&mut self, window: HWND, level: u8) {
        if self.helpers_job.is_some()
            || self.unattended_job.is_some()
            || self.closing
            || level == self.access.helpers
        {
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
    /// Opens the Windows sign-in settings as a page of this window instead of a second window.
    unsafe fn open_signin(&mut self) {
        if !self.signin_page.is_null() {
            return;
        }
        let px = |value: i32| (value as f32 * self.scale).round() as i32;
        let mut bounds = RECT {
            left: 0,
            top: 0,
            right: px(520),
            bottom: px(560),
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
        let mut client = RECT::default();
        GetClientRect(self.window, &mut client);
        let mut shown: Vec<HWND> = Vec::new();
        unsafe extern "system" fn collect(child: HWND, list: LPARAM) -> i32 {
            let list = &mut *(list as *mut Vec<HWND>);
            if IsWindowVisible(child) != 0 {
                list.push(child);
            }
            1
        }
        EnumChildWindows(
            self.window,
            Some(collect),
            std::ptr::addr_of_mut!(shown) as LPARAM,
        );
        shown.retain(|&child| GetParent(child) == self.window);
        for &child in &shown {
            ShowWindow(child, SW_HIDE);
        }
        match beacon_remote_agent::signin_settings::embed(self.window, client, self.scale) {
            Ok(page) => {
                self.signin_page = page;
                self.hidden_for_page = shown;
            }
            Err(error) => {
                for &child in &shown {
                    ShowWindow(child, SW_SHOW);
                }
                self.controls();
                text(
                    self.status,
                    &format!("Could not open sign-in settings: {error}"),
                );
            }
        }
    }
    /// Returns from the sign-in page to the main view.
    unsafe fn close_signin(&mut self) {
        if self.signin_page.is_null() {
            return;
        }
        DestroyWindow(self.signin_page);
        self.signin_page = null_mut();
        for child in self.hidden_for_page.drain(..) {
            ShowWindow(child, SW_SHOW);
        }
        self.controls();
        self.check_signin();
        SetFocus(self.action);
    }
    unsafe fn controls(&self) {
        if !self.signin_page.is_null() || !self.session_page.is_null() {
            return;
        }
        text(
            self.introduction,
            "Pair this computer with your workspace. Screen viewing and control require visible local approval.",
        );
        ShowWindow(
            self.introduction,
            if self.paired { SW_HIDE } else { SW_SHOW },
        );
        let px = |value: i32| (value as f32 * self.scale).round() as i32;
        // The status line sits under the heading once paired, and under the form before.
        MoveWindow(
            self.status,
            px(if self.paired { 84 } else { 28 }),
            px(if self.paired { 54 } else { 372 }),
            px(if self.paired { 408 } else { 464 }),
            px(if self.paired { 36 } else { 44 }),
            1,
        );
        let home = self.on_tab(0);
        MoveWindow(
            self.action,
            px(28),
            px(if self.paired { 268 } else { 322 }),
            px(if self.paired { 464 } else { 220 }),
            px(if self.paired { 48 } else { 38 }),
            1,
        );
        ShowWindow(
            self.action,
            if self.paired && !home {
                SW_HIDE
            } else {
                SW_SHOW
            },
        );
        // The window keeps one size per state, so moving between tabs never moves it.
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
        for member in &self.members {
            let shown = self.paired && member.tabs & (1 << self.tab) != 0;
            let (x, y, w, h) = member.rect;
            MoveWindow(member.window, px(x), px(y), px(w), px(h), 1);
            ShowWindow(member.window, if shown { SW_SHOW } else { SW_HIDE });
            InvalidateRect(member.window, null(), 0);
        }
        let stopping = self
            .worker
            .as_ref()
            .is_some_and(|worker| worker.cancel.load(Ordering::Acquire));
        text(self.action, primary_label(self.paired, busy, stopping));
        InvalidateRect(self.action, null(), 0);
        EnableWindow(
            self.action,
            i32::from(!self.closing && !stopping && (self.paired || !busy)),
        );
        self.show_access();
        self.show_helpers();
    }
    /// Fills the pairing form from a `beaconremote://pair` link and waits: the person sees the server it names and
    /// selects Pair computer themselves. A paired computer, or anything that is not such a link, changes nothing.
    unsafe fn fill_from_link(&mut self, link: &str) {
        if self.paired {
            text(self.status, "This computer is already paired. Remove it from your workspace first to pair it again.");
            return;
        }
        let Some((server, code)) = pairing_link(link) else {
            return;
        };
        if let Some(server) = server {
            text(self.server, &server);
        }
        text(self.code, &code);
        text(
            self.status,
            "Filled in from the link. Check the server, then select Pair computer.",
        );
        SetFocus(self.action);
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
            // A pasted pairing link fills in the server and code, then waits: the person sees which server it names
            // before anything is sent there.
            if let Some((linked_server, linked_code)) = pairing_link(&code) {
                code.zeroize();
                if let Some(linked_server) = linked_server {
                    text(self.server, &linked_server);
                }
                text(self.code, &linked_code);
                text(
                    self.status,
                    "Filled in from the link. Check the server, then select Pair computer.",
                );
                return;
            }
            // Say which box is missing, and keep what was typed: a code that fails can be fixed, not retyped from scratch.
            if let Some(missing) = missing_field(&server, &name, &code) {
                code.zeroize();
                text(self.status, missing);
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
            self.controls();
        }
    }
    fn check_signin(&mut self) {
        if self.paired && !self.closing {
            if self.signin_check.is_some() {
                self.signin_recheck = true;
                return;
            }
            self.signin_recheck = false;
            self.signin_check = Some(thread::spawn(|| {
                Ok(beacon_remote_agent::signin_endpoint::status()?.needs_repair())
            }));
        }
    }
    /// One window, one place for everything: a connection request or a running session replaces the main view and
    /// the window stays on top and cannot be closed until it ends. The page is driven by the helper's reports.
    unsafe fn follow_session(&mut self, window: HWND) {
        beacon_remote_agent::session_hub::alive();
        let view = beacon_remote_agent::session_hub::view();
        if view.session.is_some() {
            self.session_ran = true;
        }
        if view.active() && self.session_page.is_null() {
            self.open_session(&view);
        } else if !view.active() && !self.session_page.is_null() {
            self.close_session();
        } else if view.active() {
            let wanted = beacon_remote_agent::session_view::height(&view);
            if wanted != self.session_height {
                self.session_height = wanted;
                self.resize_for_page(wanted);
            }
        }
        let _ = window;
    }
    unsafe fn resize_for_page(&mut self, height: i32) {
        let px = |value: i32| (value as f32 * self.scale).round() as i32;
        let mut bounds = RECT {
            left: 0,
            top: 0,
            right: px(520),
            bottom: px(height),
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
        if !self.session_page.is_null() {
            let mut client = RECT::default();
            GetClientRect(self.window, &mut client);
            MoveWindow(self.session_page, 0, 0, client.right, client.bottom, 1);
        }
    }
    unsafe fn open_session(&mut self, view: &beacon_remote_agent::session_hub::View) {
        self.close_signin();
        restore(self.window);
        let mut shown: Vec<HWND> = Vec::new();
        unsafe extern "system" fn collect(child: HWND, list: LPARAM) -> i32 {
            let list = &mut *(list as *mut Vec<HWND>);
            if IsWindowVisible(child) != 0 {
                list.push(child);
            }
            1
        }
        EnumChildWindows(
            self.window,
            Some(collect),
            std::ptr::addr_of_mut!(shown) as LPARAM,
        );
        shown.retain(|&child| GetParent(child) == self.window);
        for &child in &shown {
            ShowWindow(child, SW_HIDE);
        }
        self.session_height = beacon_remote_agent::session_view::height(view);
        self.resize_for_page(self.session_height);
        place(self.window);
        let mut client = RECT::default();
        GetClientRect(self.window, &mut client);
        match beacon_remote_agent::session_view::embed(self.window, client, self.scale) {
            Ok(page) => {
                self.session_page = page;
                self.hidden_for_session = shown;
                // Always on top while anything is being asked or shared, so Stop is never covered.
                SetWindowPos(
                    self.window,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE,
                );
                SetForegroundWindow(self.window);
            }
            Err(_) => {
                for &child in &shown {
                    ShowWindow(child, SW_SHOW);
                }
            }
        }
    }
    unsafe fn close_session(&mut self) {
        if self.session_page.is_null() {
            return;
        }
        // The owner asked for Windows to lock whenever a remote session ends: only after a session that actually ran,
        // never after a request the person here declined or let expire.
        let ran = std::mem::take(&mut self.session_ran);
        if ran && beacon_remote_agent::local_access().lock_on_end {
            beacon_remote_agent::lock_workstation();
        }
        DestroyWindow(self.session_page);
        self.session_page = null_mut();
        SetWindowPos(
            self.window,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE,
        );
        for child in self.hidden_for_session.drain(..) {
            ShowWindow(child, SW_SHOW);
        }
        self.controls();
    }
    unsafe fn poll(&mut self, window: HWND) {
        self.follow_session(window);
        if self
            .signin_check
            .as_ref()
            .is_some_and(|job| job.is_finished())
        {
            self.signin_health = self
                .signin_check
                .take()
                .unwrap()
                .join()
                .ok()
                .and_then(Result::ok)
                .flatten();
            text(
                GetDlgItem(window, SIGNIN_SETTINGS as i32),
                match self.signin_health {
                    Some(true) => "Sign-in needs repair…",
                    Some(false) => "Sign-in access…",
                    None => "Check sign-in access…",
                },
            );
            if self.signin_recheck {
                self.check_signin();
            }
            self.show_access();
            // After an update the services still run the previous build until one administrator approval brings them
            // up to date. Say so right away, on the page where that approval is, instead of leaving it to be found.
            if self.signin_health == Some(true)
                && !self.repair_offered
                && self.session_page.is_null()
            {
                self.repair_offered = true;
                if let Some(index) = TABS.iter().position(|(tab, _)| *tab == TAB_UNATTENDED) {
                    self.tab = index as u8;
                    self.controls();
                }
                restore(window);
            }
        }
        // Kept on the Unattended page while the services still run the previous build, so a later status report
        // does not wipe the reason the page opened (written only when it differs, so nothing flickers).
        const UPDATED: &str = "Beacon Remote was updated. Approve once (Repair on this page) so unattended access uses the new version too.";
        if self.signin_health == Some(true)
            && self.repair_offered
            && self.session_page.is_null()
            && TABS
                .get(self.tab as usize)
                .is_some_and(|(tab, _)| *tab == TAB_UNATTENDED)
            && read(self.status) != UPDATED
        {
            text(self.status, UPDATED);
        }
        if self
            .unattended_job
            .as_ref()
            .is_some_and(|job| job.is_finished())
        {
            let job = self.unattended_job.take().unwrap();
            let start_after_setup = std::mem::take(&mut self.start_after_setup);
            let result = job.join();
            self.access = beacon_remote_agent::local_access();
            self.autostart_on = autostart_enabled();
            self.boot_on = beacon_remote_agent::availability::starts_at_boot().ok();
            match result {
                Ok(Ok(())) => {
                    text(self.status,"Unattended settings updated. Windows sign-in is required for desktop access.");
                    if start_after_setup
                        && self.access.trusted
                        && self.worker.is_none()
                        && !self.closing
                    {
                        self.start();
                    }
                }
                Ok(Err(error)) => text(self.status, &format!("Setup incomplete: {error}")),
                Err(_) => text(self.status, "Unattended setup did not finish. Try again."),
            }
            self.show_access();
            self.show_helpers();
            InvalidateRect(window, null(), 0);
            self.check_signin();
        }
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
                // The one-use code has done its job; it is not kept on screen.
                text(self.code, "");
                self.paired = beacon_remote_agent::is_paired();
                self.check_signin();
                if self.paired {
                    text(self.heading, "This computer");
                }
                // The host starts by itself right after pairing (below).
                text(self.status, "Computer paired · Starting…");
                if self.paired && !self.closing {
                    self.start();
                }
            } else if success {
                text(
                    self.status,
                    "Stopped · Select Start host when you are ready.",
                );
            } else if worker.pairing {
                text(self.status, "Pairing failed. Check the code for a typo, or the server and network; if it still fails, ask for a new code in your workspace (each works once for five minutes).");
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
        if self.closing && self.worker.is_none() && self.unattended_job.is_none() {
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
        // The character at the top: awake and signalling when reachable, asleep when stopped.
        let (mood, body, tile) = match state.pill_mode() {
            0 => (ui::Mood::Wow, ui::SUN, p.warn_soft),
            1 => (ui::Mood::Asleep, ui::SLEEP, p.subtle),
            2 => (ui::Mood::Awake, p.accent, p.accent_soft),
            3 => (ui::Mood::Awake, ui::MINT, p.success_soft),
            _ => (ui::Mood::Wow, ui::CORAL, p.danger_soft),
        };
        ui::mark(&canvas, p, (28.0, 14.0, 46.0), mood, body);
        let on_home = state.paired && state.tab == 0;
        if on_home {
            canvas.fill(28.0, 156.0, 464.0, 96.0, 16.0, tile);
            canvas.stroke(28.0, 156.0, 464.0, 96.0, 16.0, p.line, 1.0);
            ui::icon(&canvas, ui::Icon::Monitor, 44.0, 194.0, p.accent);
            ui::icon(&canvas, ui::Icon::Lock, 44.0, 218.0, p.accent);
            canvas.fill(28.0, 332.0, 464.0, 132.0, 16.0, p.surface);
            canvas.stroke(28.0, 332.0, 464.0, 132.0, 16.0, p.line, 1.0);
            canvas.line(44.0, 382.0, 476.0, 382.0, p.line, 1.0);
            canvas.line(44.0, 422.0, 476.0, 422.0, p.line, 1.0);
        } else if state.paired && state.tab == 2 {
            canvas.fill(28.0, 156.0, 464.0, 134.0, 16.0, p.surface);
            canvas.stroke(28.0, 156.0, 464.0, 134.0, 16.0, p.line, 1.0);
        } else if state.paired && state.tab == 1 {
            canvas.line(28.0, 278.0, 492.0, 278.0, p.line, 1.0);
        } else if state.paired && state.tab == 3 {
            canvas.line(28.0, 344.0, 492.0, 344.0, p.line, 1.0);
        }
        if state.paired {
            // The tab strip's rule, under the tabs.
            canvas.line(28.0, 142.0, 492.0, 142.0, p.line, 1.0);
        } else {
            for top in [124.0, 192.0, 260.0] {
                canvas.fill(28.0, top, 464.0, 34.0, 17.0, p.subtle);
                canvas.stroke(28.0, top, 464.0, 34.0, 17.0, p.line, 1.0);
            }
        }
        // On the Home tile the capsule sits on the tinted tile, so it takes the white surface to stay visible;
        // a stopped computer's tile is plain, so its capsule takes the window colour to show against it.
        let fill = if !on_home {
            fill
        } else if state.pill_mode() == 1 {
            p.window
        } else {
            p.surface
        };
        let pill_width = if state.pill_mode() == 4 { 124.0 } else { 100.0 };
        ui::pill(
            &canvas,
            (
                (if on_home { 476.0 } else { 492.0 }) - pill_width,
                if on_home { 164.0 } else { 26.0 },
                pill_width,
                26.0,
            ),
            label,
            fill,
            line,
            ink,
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
        CLIP_OFF => Some(state.clip_mode == 0),
        CLIP_BUTTON => Some(state.clip_mode == 1),
        CLIP_AUTO => Some(state.clip_mode == 2),
        _ => None,
    };
    if matches!(id, TAB_HOME | TAB_ACCESS | TAB_UNATTENDED | TAB_SUPPORT) {
        // A tab: the chosen one is a tinted pill, the rest are plain words.
        let chosen = TABS
            .iter()
            .position(|(tab, _)| *tab == id)
            .is_some_and(|index| index as u8 == state.tab);
        if chosen {
            canvas.fill(0.0, 0.0, w, h, h / 2.0, p.accent_soft);
        } else if flags.hot || flags.pressed {
            canvas.fill(0.0, 0.0, w, h, h / 2.0, p.subtle);
        }
        canvas.text(
            &label,
            (0.0, 0.0, w, h),
            14.0,
            if chosen { 700 } else { 500 },
            if chosen { p.accent } else { p.muted },
            ui::Align::Center,
            true,
        );
        if flags.focused {
            canvas.stroke(1.0, 1.0, w - 2.0, h - 2.0, (h - 2.0) / 2.0, p.accent, 2.0);
        }
    } else if let Some(selected) = selected {
        // A segment of a three-way choice: the chosen one is tinted and outlined.
        let (fill, border, ink) = if flags.disabled {
            (p.surface, p.line, p.faint)
        } else if selected {
            (p.accent_soft, p.accent, p.strong)
        } else if flags.hot || flags.pressed {
            (p.tile_hover, p.line, p.strong)
        } else {
            (p.surface, p.line, p.text)
        };
        canvas.fill(0.0, 0.0, w, h, 12.0, fill);
        canvas.stroke(
            1.0,
            1.0,
            w - 2.0,
            h - 2.0,
            11.0,
            border,
            if selected { 2.0 } else { 1.0 },
        );
        canvas.text(
            &label,
            (8.0, 0.0, w - 16.0, h),
            13.5,
            if selected { 700 } else { 500 },
            ink,
            ui::Align::Center,
            true,
        );
        if flags.focused {
            canvas.stroke(3.0, 3.0, w - 6.0, h - 6.0, 9.0, p.accent, 1.5);
        }
    } else if id == AUTOSTART || id == FILES || id == BOOT_START {
        let on = match id {
            FILES => state.access.files,
            BOOT_START => state.boot_on == Some(true),
            _ => state.autostart_on,
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
        let configured = state.access.trusted
            && state.access.allow_control
            && state.access.files
            && state.autostart_on;
        let role = match id {
            // Stopping is routine, so it is the quiet button; starting and pairing lead.
            ACTION if label == "Stop host" => ui::Role::Secondary,
            ACTION | UNATTENDED => ui::Role::Primary,
            UNATTENDED_OFF if configured => ui::Role::Danger,
            _ => ui::Role::Secondary,
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
        WM_COPYDATA if !state.is_null() => {
            let data = &*(lparam as *const COPYDATASTRUCT);
            let units = data.cbData as usize / 2;
            if data.dwData == LINK_MESSAGE && units <= MAX_LINK && !data.lpData.is_null() {
                let link = String::from_utf16_lossy(std::slice::from_raw_parts(
                    data.lpData as *const u16,
                    units,
                ));
                (*state).fill_from_link(&link);
                return 1;
            }
            return 0;
        }
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
            SetBkColor(wparam as _, ui::colorref(p.subtle));
            return ui::surface_brush(p.subtle) as isize;
        }
        WM_COMMAND if !state.is_null() && (wparam >> 16) == BN_CLICKED as usize => {
            match wparam & 0xffff {
                SERVER_CHANGE => {
                    SendMessageW((*state).server, EM_SETREADONLY, 0, 0);
                    SendMessageW((*state).server, EM_SETSEL, 0, -1);
                    SetFocus((*state).server);
                    ShowWindow(GetDlgItem(window, SERVER_CHANGE as i32), SW_HIDE);
                }
                ACTION => {
                    if (*state).paired && (*state).worker.is_some() {
                        (*state).stop();
                    } else {
                        (*state).start();
                    }
                }
                AUTOSTART => {
                    if (*state).unattended_job.is_some() || (*state).closing {
                        return 0;
                    }
                    let wanted = !(*state).autostart_on;
                    if set_autostart(wanted) {
                        (*state).autostart_on = wanted;
                    } else {
                        text((*state).status, "Could not change start at sign-in.");
                    }
                    InvalidateRect((*state).autostart, null(), 0);
                    (*state).show_access();
                }
                BOOT_START => (*state).toggle_boot_start(),
                FILES => {
                    let wanted = !(*state).access.files;
                    if beacon_remote_agent::set_files(wanted).is_ok() {
                        (*state).access = beacon_remote_agent::local_access();
                    } else {
                        text((*state).status, "Could not change file transfer.");
                    }
                    InvalidateRect((*state).files, null(), 0);
                }
                id @ (TAB_HOME | TAB_ACCESS | TAB_UNATTENDED | TAB_SUPPORT) => {
                    if let Some(index) = TABS.iter().position(|(tab, _)| *tab == id) {
                        (*state).tab = index as u8;
                        (*state).controls();
                        SetFocus(GetDlgItem(window, id as i32));
                    }
                }
                SUPPORT_VIEW => (*state).ask_support(false),
                SUPPORT_CONTROL => (*state).ask_support(true),
                UPDATE => (*state).update_clicked(window),
                HELPERS_OFF => (*state).choose_helpers(window, 0),
                HELPERS_VIEW => (*state).choose_helpers(window, 1),
                HELPERS_CONTROL => (*state).choose_helpers(window, 2),
                CLIP_OFF => (*state).choose_clipboard(0),
                CLIP_BUTTON => (*state).choose_clipboard(1),
                CLIP_AUTO => (*state).choose_clipboard(2),
                ACCESS_ASK => (*state).choose_access(window, 0),
                ACCESS_VIEW => (*state).choose_access(window, 1),
                ACCESS_CONTROL => (*state).choose_access(window, 2),
                UNATTENDED => (*state).setup_unattended(),
                SIGNIN_SETTINGS => {
                    if (*state).unattended_job.is_none()
                        && (*state).access_job.is_none()
                        && (*state).helpers_job.is_none()
                        && !(*state).closing
                    {
                        restore(window);
                        (*state).open_signin();
                    }
                }
                UNATTENDED_OFF => {
                    if (*state).unattended_job.is_none() && (*state).access_job.is_none() {
                        text((*state).status, "Turning off unattended access…");
                        (*state).start_after_setup = false;
                        (*state).unattended_job = Some(thread::spawn(|| {
                            let lowered = beacon_remote_agent::set_access(false, false);
                            // Local service removal must not depend on a successful policy POST.
                            beacon_remote_agent::signin_endpoint::remove()?;
                            beacon_remote_agent::availability::remove()?;
                            lowered
                        }));
                    }
                }
                TRAY_SHOW => restore(window),
                TRAY_LOCK_ON_END => {
                    let on = !beacon_remote_agent::local_access().lock_on_end;
                    if beacon_remote_agent::set_lock_on_end(on).is_ok() {
                        (*state).access = beacon_remote_agent::local_access();
                    }
                }
                TRAY_STOP => (*state).stop(),
                TRAY_QUIT => {
                    SendMessageW(window, WM_CLOSE, 0, 0);
                }
                _ => {}
            }
            return 0;
        }
        WM_SIZE if !state.is_null() && wparam == SIZE_MINIMIZED as usize && (*state).tray => {
            if !(*state).session_page.is_null() {
                // Never hidden while a request is open or a screen is shared.
                ShowWindow(window, SW_RESTORE);
                return 0;
            }
            ShowWindow(window, SW_HIDE);
            return 0;
        }
        beacon_remote_agent::signin_settings::BACK if !state.is_null() => {
            (*state).close_signin();
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
                    if (*state).paired {
                        AppendMenuW(
                            menu,
                            MF_STRING
                                | if (*state).access.lock_on_end {
                                    MF_CHECKED
                                } else {
                                    0
                                },
                            TRAY_LOCK_ON_END,
                            wide("Lock this computer when a remote session ends").as_ptr(),
                        );
                    }
                    if (*state).paired {
                        let available = (*state).unattended_job.is_none()
                            && (*state).access_job.is_none()
                            && (*state).helpers_job.is_none()
                            && !(*state).closing;
                        AppendMenuW(
                            menu,
                            MF_STRING | if available { 0 } else { MF_GRAYED },
                            SIGNIN_SETTINGS,
                            wide(if (*state).signin_health == Some(true) {
                                "Windows sign-in needs repair…"
                            } else {
                                "Windows sign-in access…"
                            })
                            .as_ptr(),
                        );
                    }
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
        WM_CLOSE if !state.is_null() && !(*state).session_page.is_null() && !(*state).closing => {
            // Closing is not a way to hide a shared screen; Stop ends the session first.
            return 0;
        }
        WM_CLOSE if !state.is_null() => {
            (*state).close_signin();
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

fn clip_folder() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| std::path::PathBuf::from(base).join("BeaconRemote"))
}

/// The chosen clipboard mode: 0 off, 1 button only (the default), 2 automatic.
fn read_clip_mode() -> u8 {
    let text = clip_folder()
        .and_then(|folder| std::fs::read_to_string(folder.join("clipboard-mode.txt")).ok());
    clip_mode_from(text.as_deref())
}

fn clip_mode_from(text: Option<&str>) -> u8 {
    match text.map(|text| text.trim().to_ascii_lowercase()).as_deref() {
        Some("off") => 0,
        Some("auto") => 2,
        _ => 1,
    }
}

fn write_clip_mode(level: u8) -> bool {
    let Some(folder) = clip_folder() else {
        return false;
    };
    let name = match level {
        0 => "off",
        2 => "auto",
        _ => "button",
    };
    std::fs::create_dir_all(&folder).is_ok()
        && std::fs::write(folder.join("clipboard-mode.txt"), name).is_ok()
}

/// How long ago a viewer last set the clipboard, in words, if one ever did.
fn last_clip_write_ago() -> Option<String> {
    let folder = clip_folder()?;
    let at: u128 = std::fs::read_to_string(folder.join("clipboard-last-write.txt"))
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some(clip_ago(now.saturating_sub(at) / 1000))
}

fn clip_ago(seconds: u128) -> String {
    match seconds {
        0..=59 => "just now".to_owned(),
        60..=3599 => format!("{} min ago", seconds / 60),
        3600..=86_399 => format!("{} h ago", seconds / 3600),
        _ => format!("{} days ago", seconds / 86_400),
    }
}

/// How much to scale the fixed layout: the system scale, reduced so the tallest page plus the (system-scaled)
/// frame fits the work area, but never below 70% of the system scale.
fn fit_factor(system: f32, available: f32, frame: f32, content: f32) -> f32 {
    if available <= frame {
        return system;
    }
    system.min((available - frame) / content).max(system * 0.7)
}

/// `link`: a `beaconremote://pair?…` link this program was opened with (the web's "Open link"). It fills in the
/// pairing form, in this window or in the one already open; pairing still waits for the person to select Pair.
pub fn show(background: bool, link: Option<String>) -> Result<(), io::Error> {
    unsafe {
        // Draw at the screen's real scale instead of letting Windows stretch a 96 dpi bitmap, which blurs the text.
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_SYSTEM_AWARE);
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
            // Bring the open window forward rather than putting a second window on screen.
            let existing = FindWindowW(wide("BeaconRemoteHostWindow").as_ptr(), null());
            if existing.is_null() {
                MessageBoxW(null_mut(), wide("Beacon Remote host is already open. Use its existing window to start or stop sharing.").as_ptr(), wide("Beacon Remote").as_ptr(), MB_OK | MB_ICONINFORMATION);
            } else {
                if let Some(link) = link.as_deref().filter(|link| link.len() <= MAX_LINK) {
                    let units: Vec<u16> = link.encode_utf16().collect();
                    let data = COPYDATASTRUCT {
                        dwData: LINK_MESSAGE,
                        cbData: (units.len() * 2) as u32,
                        lpData: units.as_ptr() as *mut _,
                    };
                    SendMessageW(existing, WM_COPYDATA, 0, std::ptr::addr_of!(data) as LPARAM);
                }
                restore(existing);
            }
            return Ok(());
        }
        let system = GetDpiForSystem().max(96) as f32 / 96.0;
        // The window is a fixed layout at 100%. On a small, high-DPI screen it could be taller than the
        // work area, which would push its bottom (and the Stop button) off screen, so shrink it to fit.
        let mut work = RECT::default();
        SystemParametersInfoW(SPI_GETWORKAREA, 0, std::ptr::addr_of_mut!(work).cast(), 0);
        // The title bar and frame are drawn at the system DPI whatever the content is scaled to.
        let mut frame = RECT::default();
        AdjustWindowRectEx(
            &mut frame,
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
            0,
            0,
        );
        let factor = fit_factor(
            system,
            (work.bottom - work.top) as f32,
            (frame.bottom - frame.top) as f32,
            PAIRED_HEIGHT as f32,
        );
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
            status: null_mut(),
            introduction: null_mut(),
            heading: null_mut(),
            last_status: None,
            enrollment: Vec::new(),
            members: Vec::new(),
            tab: 0,
            access_help: null_mut(),
            helper_help: null_mut(),
            unattended_status: null_mut(),
            version_line: null_mut(),
            summary: [null_mut(); 3],
            tray: false,
            tray_status: String::new(),
            incoming_seen: beacon_remote_agent::incoming::mark(),
            taskbar_created: RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()),
            access: beacon_remote_agent::local_access(),
            radios: [null_mut(); 3],
            helper_radios: [null_mut(); 3],
            clip_radios: [null_mut(); 3],
            clip_help: null_mut(),
            clip_mode: read_clip_mode(),
            update_button: null_mut(),
            update_offer: None,
            update_check: None,
            update_install: None,
            signin_check: None,
            repair_offered: false,
            session_ran: false,
            signin_health: None,
            signin_recheck: false,
            helpers_job: None,
            autostart: null_mut(),
            support: [null_mut(); 2],
            support_job: None,
            access_job: None,
            unattended_job: None,
            start_after_setup: false,
            window: null_mut(),
            palette: ui::palette(),
            scale: factor,
            hot: 0,
            autostart_on: autostart_enabled(),
            boot_start: null_mut(),
            boot_on: beacon_remote_agent::availability::starts_at_boot().ok(),
            files: null_mut(),
            pill_key: 255,
            fonts: Vec::new(),
            signin_page: null_mut(),
            hidden_for_page: Vec::new(),
            session_page: null_mut(),
            hidden_for_session: Vec::new(),
            session_height: 0,
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
                84,
                22,
                290,
                32,
                SS_NOPREFIX,
                H_HEADING as usize,
            )?;
            state.heading = heading;
            state.introduction =
                child("STATIC", "", 28, 58, 464, 40, SS_NOPREFIX, H_INTRO as usize)?;
            state.status = child(
                "STATIC",
                if paired {
                    "Computer paired · Starting…"
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
            // Enrollment: three fields, each on a card drawn behind it. Each label is created right before its edit
            // box, so Windows (UI Automation, Narrator) names every box by its own label; created all at once, the
            // server box took the last label's name and the other two had none.
            let field = WS_TABSTOP | ES_AUTOHSCROLL as u32;
            let mut labelled = |label: &str,
                                top: i32,
                                text: &str,
                                style: u32,
                                id: usize|
             -> Result<HWND, io::Error> {
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
                child("EDIT", text, 40, top + 30, 440, 22, style, id)
            };
            let server = labelled("Server", 100, DEFAULT_SERVER, field, SERVER)?;
            let name = labelled("Computer name", 168, &computer, field, NAME)?;
            // Shown in plain, capital letters: it is short, works once and expires, and a hidden code hides typos.
            let code = labelled(
                "Pairing code, like AB3K-9PQ2",
                236,
                "",
                field | ES_UPPERCASE as u32,
                CODE,
            )?;
            state.server = server;
            state.name = name;
            state.code = code;
            SendMessageW(state.server, EM_SETLIMITTEXT, 2048, 0);
            SendMessageW(state.name, EM_SETLIMITTEXT, 80, 0);
            SendMessageW(state.code, EM_SETLIMITTEXT, 256, 0);
            state
                .enrollment
                .extend([state.server, state.name, state.code]);
            // Most people use the default workspace: its address is shown but not in the way. "Change" makes it
            // editable for a self-hosted workspace; a pairing link fills it in either way.
            SendMessageW(state.server, EM_SETREADONLY, 1, 0);
            MoveWindow(
                state.server,
                scale(40),
                scale(130),
                scale(330),
                scale(22),
                0,
            );
            let change = child(
                "BUTTON",
                "Change",
                384,
                125,
                96,
                32,
                owner_draw,
                SERVER_CHANGE,
            )?;
            state.enrollment.push(change);

            // Paired view: four tabs on one fixed-size page. Every control is created once, with the tabs it
            // belongs to and its place; `controls()` shows and moves them.
            let mut members: Vec<Member> = Vec::new();
            let mut titles: Vec<HWND> = Vec::new();
            let mut bodies: Vec<HWND> = Vec::new();
            const HOME: u8 = 1;
            const ACCESS: u8 = 2;
            const UNATT: u8 = 4;
            const SUPPORT: u8 = 8;
            const EVERY: u8 = 15;
            let mut add = |class: &str,
                           label: &str,
                           tabs: u8,
                           rect: (i32, i32, i32, i32),
                           extra: u32,
                           id: usize|
             -> Result<HWND, io::Error> {
                let handle = child(class, label, rect.0, rect.1, rect.2, rect.3, extra, id)?;
                members.push(Member {
                    window: handle,
                    tabs,
                    rect,
                });
                Ok(handle)
            };
            // Tab strip.
            for (index, (id, label)) in TABS.into_iter().enumerate() {
                add(
                    "BUTTON",
                    label,
                    EVERY,
                    (28 + 118 * index as i32, 98, 110, 40),
                    owner_draw,
                    id,
                )?;
            }
            // Home.
            let name_line = add(
                "STATIC",
                &computer,
                HOME,
                (44, 166, 300, 22),
                SS_NOPREFIX,
                H_NAME as usize,
            )?;
            let info_one = add(
                "STATIC",
                &format!(
                    "{} · Beacon Remote host {}",
                    windows_name(),
                    env!("CARGO_PKG_VERSION")
                ),
                HOME,
                (70, 192, 410, 20),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            let info_two = add(
                "STATIC",
                &format!(
                    "Paired to {}",
                    beacon_remote_agent::paired_server().unwrap_or_else(|| "your workspace".into())
                ),
                HOME,
                (70, 216, 410, 20),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            let home_hint = add(
                "STATIC",
                "Change these on the Access and Unattended tabs. Anyone else always asks first.",
                HOME,
                (28, 476, 464, 40),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            let mut summary_labels = Vec::new();
            for (index, label) in [
                "Your own account",
                "People you remembered",
                "Unattended access",
            ]
            .into_iter()
            .enumerate()
            {
                let top = 346 + 40 * index as i32;
                summary_labels.push(add(
                    "STATIC",
                    label,
                    HOME,
                    (44, top, 200, 22),
                    SS_NOPREFIX,
                    H_INFO as usize,
                )?);
                state.summary[index] = add(
                    "STATIC",
                    "",
                    HOME,
                    (250, top, 226, 22),
                    SS_NOPREFIX,
                    H_NAME as usize,
                )?;
            }
            // Access.
            let access_title = add(
                "STATIC",
                "Your own account",
                ACCESS,
                (28, 158, 464, 22),
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            for (index, (label, id)) in [
                ("Ask each time", ACCESS_ASK),
                ("View only", ACCESS_VIEW),
                ("View and control", ACCESS_CONTROL),
            ]
            .into_iter()
            .enumerate()
            {
                state.radios[index] = add(
                    "BUTTON",
                    label,
                    ACCESS,
                    (28 + 156 * index as i32, 186, 152, 44),
                    owner_draw,
                    id,
                )?;
            }
            state.access_help = add(
                "STATIC",
                "",
                ACCESS,
                (28, 238, 464, 38),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            let helpers_title = add(
                "STATIC",
                "People you remembered",
                ACCESS,
                (28, 290, 464, 22),
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            for (index, (label, id)) in [
                ("Ask each time", HELPERS_OFF),
                ("View only", HELPERS_VIEW),
                ("View and control", HELPERS_CONTROL),
            ]
            .into_iter()
            .enumerate()
            {
                state.helper_radios[index] = add(
                    "BUTTON",
                    label,
                    ACCESS,
                    (28 + 156 * index as i32, 318, 152, 44),
                    owner_draw,
                    id,
                )?;
            }
            state.helper_help = add(
                "STATIC",
                "",
                ACCESS,
                (28, 370, 464, 38),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            let clip_title = add(
                "STATIC",
                "Clipboard",
                ACCESS,
                (28, 420, 464, 22),
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            for (index, (label, id)) in [
                ("Off", CLIP_OFF),
                ("Button only", CLIP_BUTTON),
                ("Automatic", CLIP_AUTO),
            ]
            .into_iter()
            .enumerate()
            {
                state.clip_radios[index] = add(
                    "BUTTON",
                    label,
                    ACCESS,
                    (28 + 156 * index as i32, 448, 152, 44),
                    owner_draw,
                    id,
                )?;
            }
            state.clip_help = add(
                "STATIC",
                "",
                ACCESS,
                (28, 500, 464, 38),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            state.files = add(
                "BUTTON",
                "Also let my account send files to this computer",
                ACCESS,
                (28, 552, 464, 26),
                owner_draw,
                FILES,
            )?;
            // Unattended.
            let unattended_title = add(
                "STATIC",
                "Unattended access",
                UNATT,
                (44, 168, 432, 22),
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            let unattended_text = add(
                "STATIC",
                "Connect to your own computers when nobody is there to click Allow. The sharing indicator and Stop stay on screen, and you can turn this off here at any time.",
                UNATT,
                (44, 194, 432, 62),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            state.unattended_status = add(
                "STATIC",
                "",
                UNATT,
                (44, 260, 432, 22),
                SS_NOPREFIX,
                H_STATUS as usize,
            )?;
            add(
                "BUTTON",
                "Set up unattended access",
                UNATT,
                (28, 300, 464, 44),
                owner_draw,
                UNATTENDED,
            )?;
            add(
                "BUTTON",
                "Turn off unattended access",
                UNATT,
                (28, 352, 464, 44),
                owner_draw,
                UNATTENDED_OFF,
            )?;
            state.autostart = add(
                "BUTTON",
                "Start Beacon Remote when I sign in to Windows",
                UNATT,
                (28, 410, 464, 26),
                owner_draw,
                AUTOSTART,
            )?;
            state.boot_start = add(
                "BUTTON",
                "Start before Windows sign-in (administrator setup)",
                UNATT,
                (28, 440, 464, 26),
                owner_draw,
                BOOT_START,
            )?;
            // Support.
            let support_title = add(
                "STATIC",
                "Help from, or for, someone you trust",
                SUPPORT,
                (28, 158, 464, 22),
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            let support_text = add(
                "STATIC",
                "Create a one-time code. Whoever enters it asks to view or control this computer, and you still approve it.",
                SUPPORT,
                (28, 184, 464, 40),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            for (index, (label, id, top)) in [
                ("Support code: view only", SUPPORT_VIEW, 234),
                ("Support code: view and control", SUPPORT_CONTROL, 286),
            ]
            .into_iter()
            .enumerate()
            {
                state.support[index] =
                    add("BUTTON", label, SUPPORT, (28, top, 464, 44), owner_draw, id)?;
            }
            let updates_title = add(
                "STATIC",
                "Updates",
                SUPPORT,
                (28, 362, 464, 22),
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            state.version_line = add(
                "STATIC",
                &format!(
                    "Beacon Remote host {}. Updates are signed and only installed when you ask.",
                    env!("CARGO_PKG_VERSION")
                ),
                SUPPORT,
                (28, 388, 464, 40),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            state.update_button = add(
                "BUTTON",
                "Check for updates",
                SUPPORT,
                (28, 436, 464, 44),
                owner_draw,
                UPDATE,
            )?;
            // The identity key: what a browser pins for this computer (ADR 0061), to compare by eye.
            let identity_title = add(
                "STATIC",
                "This computer's identity",
                SUPPORT,
                (28, 492, 464, 22),
                SS_NOPREFIX,
                H_SECTION as usize,
            )?;
            let identity_text = add(
                "STATIC",
                &match beacon_remote_agent::identity_key_code() {
                    Some(code) => format!(
                        "Key {code}. Your browser remembers this the first time you connect; the codes should match."
                    ),
                    None => "Pair this computer to see its identity key.".to_owned(),
                },
                SUPPORT,
                (28, 518, 464, 40),
                SS_NOPREFIX,
                H_INFO as usize,
            )?;
            // Sign-in screen access is a page of its own; its entry sits with the setup it belongs to.
            let signin_entry = add(
                "BUTTON",
                "Sign-in screen access…",
                UNATT,
                (28, 474, 464, 40),
                owner_draw,
                SIGNIN_SETTINGS,
            )?;
            let _ = signin_entry;
            titles.extend([
                name_line,
                access_title,
                helpers_title,
                unattended_title,
                support_title,
                updates_title,
                clip_title,
                identity_title,
            ]);
            titles.extend(state.summary);
            bodies.extend(summary_labels);
            bodies.extend([
                info_one,
                info_two,
                home_hint,
                state.access_help,
                state.helper_help,
                unattended_text,
                state.unattended_status,
                support_text,
                state.version_line,
                state.clip_help,
                identity_text,
            ]);
            state.members = members;
            // The main button is shared by pairing and the host toggle; it is not a tab member.
            state.action = child(
                "BUTTON",
                "Pair computer",
                28,
                if paired { 268 } else { 322 },
                220,
                38,
                owner_draw | WS_VISIBLE,
                ACTION,
            )?;

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
            for &handle in &titles {
                set(handle, strong);
            }
            for &label in state.enrollment.iter().take(3) {
                set(label, label_font);
            }
            for handle in [state.introduction, state.status] {
                set(handle, body);
            }
            for &handle in &bodies {
                set(handle, body);
            }
            for handle in [state.server, state.name, state.code] {
                set(handle, edit_font);
            }
            state.controls();
            state.show_access();
            state.show_helpers();
            state.check_signin();
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
        // Opened by hand on a paired computer: the host goes online at once, with the window showing
        // its status, so there is no Start button to find. Stop host still stops it, and every
        // connection still needs local approval.
        if background && state.paired && state.tray {
            ShowWindow(window, SW_HIDE);
            state.start();
        } else {
            ShowWindow(window, SW_SHOW);
            if state.paired {
                state.start();
            }
        }
        SetFocus(if state.paired {
            state.action
        } else {
            state.code
        });
        if let Some(link) = link.as_deref() {
            state.fill_from_link(link);
        }
        let mut message = MSG::default();
        loop {
            let result = GetMessageW(&mut message, null_mut(), 0, 0);
            if result <= 0 {
                break;
            }
            // The sign-in page is a child; keyboard navigation then stays inside it.
            let target = if !state.signin_page.is_null() && IsWindow(state.signin_page) != 0 {
                state.signin_page
            } else {
                window
            };
            if IsDialogMessageW(target, &message) == 0 {
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

#[cfg(test)]
mod fit_tests {
    use super::{clip_ago, clip_mode_from, fit_factor, missing_field, pairing_link};

    #[test]
    fn a_pairing_link_gives_its_server_and_code_and_nothing_else_does() {
        assert_eq!(
            pairing_link(
                "beaconremote://pair?code=AB3K-9PQ2&server=https%3A%2F%2Fremote.example.com"
            ),
            Some((
                Some("https://remote.example.com".to_string()),
                "AB3K-9PQ2".to_string()
            ))
        );
        assert_eq!(
            pairing_link("  beaconremote://pair?code=AB3K-9PQ2  "),
            Some((None, "AB3K-9PQ2".to_string()))
        );
        for not_a_link in [
            "AB3K-9PQ2",
            "",
            "https://remote.example.com/pair?code=AB3K-9PQ2",
            "beaconremote://other?code=AB3K-9PQ2",
            "beaconremote://pair?server=https%3A%2F%2Fx",
            "beaconremote://pair?code=",
            "not a url",
        ] {
            assert_eq!(pairing_link(not_a_link), None, "{not_a_link:?}");
        }
        // An absurdly long value is ignored, not copied into a box.
        assert_eq!(
            pairing_link(&format!("beaconremote://pair?code={}", "A".repeat(100))),
            None
        );
    }

    #[test]
    fn an_incomplete_pairing_form_names_the_first_box_to_fill_in() {
        assert_eq!(
            missing_field("", "PC", "AB3K-9PQ2"),
            Some("Enter the server address.")
        );
        assert_eq!(
            missing_field("  ", "PC", "AB3K-9PQ2"),
            Some("Enter the server address.")
        );
        assert_eq!(
            missing_field("https://x", " ", "AB3K-9PQ2"),
            Some("Give this computer a name.")
        );
        assert!(missing_field("https://x", "PC", "")
            .unwrap()
            .contains("pairing code"));
        assert!(missing_field("https://x", "PC", "   ").is_some());
        assert_eq!(missing_field("https://x", "PC", "AB3K-9PQ2"), None);
        // A code typed any way counts as present; the server decides whether it is valid.
        assert_eq!(missing_field("https://x", "PC", "ab3k 9pq2"), None);
    }

    #[test]
    fn the_clipboard_setting_defaults_to_button_only_and_words_are_plain() {
        assert_eq!(clip_mode_from(None), 1);
        assert_eq!(clip_mode_from(Some("nonsense")), 1);
        assert_eq!(clip_mode_from(Some(" Off\r\n")), 0);
        assert_eq!(clip_mode_from(Some("AUTO")), 2);
        assert_eq!(clip_ago(5), "just now");
        assert_eq!(clip_ago(150), "2 min ago");
        assert_eq!(clip_ago(7200), "2 h ago");
        assert_eq!(clip_ago(200_000), "2 days ago");
    }

    #[test]
    fn the_window_keeps_the_system_scale_when_it_fits_and_shrinks_only_as_far_as_needed() {
        // Plenty of room: 175% system scale, tall work area.
        assert_eq!(fit_factor(1.75, 1700.0, 90.0, 526.0), 1.75);
        // 1280x720 at 150%: the 72 px frame at system DPI comes off the 680 px work area first.
        let factor = fit_factor(1.5, 680.0, 72.0, 526.0);
        assert!((1.05..1.5).contains(&factor));
        assert!(526.0 * factor + 72.0 <= 680.0 + 0.01);
        // Never below 70% of the system scale, even if that still does not fit.
        assert_eq!(fit_factor(2.0, 400.0, 100.0, 526.0), 1.4);
        // An unknown or tiny work area keeps the system scale.
        assert_eq!(fit_factor(1.25, 0.0, 60.0, 526.0), 1.25);
    }
}
