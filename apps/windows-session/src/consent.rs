//! Local approval with cancellation, a monotonic deadline and default decline.
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{CreateFontW, DeleteObject, COLOR_WINDOW, DEFAULT_CHARSET, HFONT},
    System::{
        LibraryLoader::GetModuleHandleW, SystemServices::SS_NOPREFIX, Threading::GetCurrentThreadId,
    },
    UI::{HiDpi::GetDpiForSystem, Input::KeyboardAndMouse::SetFocus, WindowsAndMessaging::*},
};

type Error = Box<dyn std::error::Error + Send + Sync>;
struct Font(HFONT);
impl Drop for Font {
    fn drop(&mut self) {
        unsafe {
            DeleteObject(self.0);
        }
    }
}
struct State {
    pending: Arc<AtomicBool>,
    deadline: Instant,
    accepted: bool,
    default_button: usize,
}
impl State {
    fn live(&self) -> bool {
        self.pending.load(Ordering::Acquire)
            && Instant::now() < self.deadline
            && crate::capture::desktop_receives_input()
    }
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
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
            WM_COMMAND
                if wparam >> 16 == BN_CLICKED as usize
                    && matches!((wparam & 0xffff) as i32, IDYES | IDNO | IDCANCEL | IDOK) =>
            {
                // Only the explicit Allow viewing control can approve. A close,
                // Escape, error, expired/cancelled request or unavailable desktop denies.
                (*state).accepted = (wparam & 0xffff) as i32 == IDYES && (*state).live();
                DestroyWindow(window);
                return 0;
            }
            WM_CLOSE => {
                (*state).accepted = false;
                DestroyWindow(window);
                return 0;
            }
            WM_TIMER if !(*state).live() => {
                (*state).accepted = false;
                DestroyWindow(window);
                return 0;
            }
            DM_GETDEFID => {
                return ((DC_HASDEFID as usize) << 16 | (*state).default_button) as isize
            }
            DM_SETDEFID => {
                (*state).default_button = wparam;
                return 1;
            }
            _ => {}
        }
    }
    if message == WM_DESTROY {
        KillTimer(window, 1);
        PostQuitMessage(0);
        return 0;
    }
    if message == WM_NCDESTROY {
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
    }
    DefWindowProcW(window, message, wparam, lparam)
}

pub fn request(
    controller: &str,
    pending: Arc<AtomicBool>,
    deadline: Instant,
) -> Result<bool, Error> {
    let mut state = State {
        pending,
        deadline,
        accepted: false,
        default_button: IDNO as usize,
    };
    if !state.live() {
        return Ok(false);
    }
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
            hbrBackground: (COLOR_WINDOW + 1) as _,
            ..Default::default()
        };
        if RegisterClassW(&definition) == 0 {
            return Err(io::Error::last_os_error().into());
        }
        let result = (|| -> Result<bool, Error> {
            let scale = |value: i32| value * GetDpiForSystem().max(96) as i32 / 96;
            let font = Font(CreateFontW(
                -scale(16),
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
                wide("Segoe UI").as_ptr(),
            ));
            if font.0.is_null() {
                return Err(io::Error::last_os_error().into());
            }
            let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
            let mut bounds = RECT {
                left: 0,
                top: 0,
                right: scale(680),
                bottom: scale(400),
            };
            if AdjustWindowRectEx(&mut bounds, style, 0, WS_EX_TOPMOST) == 0 {
                return Err(io::Error::last_os_error().into());
            }
            let title = wide("Beacon Remote — allow desktop viewing?");
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
            let initialized = (|| -> Result<(), Error> {
                let controller = controller
                    .chars()
                    .filter(|character| !character.is_control())
                    .collect::<String>();
                let text = wide(&format!("Requested by: {controller}\n\nAllow this browser to view your primary display for at most two minutes. A Windows capture border and local Stop sharing control stay visible.\n\nMicrophone, recording and remote input are disabled.\nLocking Windows ends sharing. A cancelled or expired request closes this prompt."));
                let label_class = wide("STATIC");
                let label = CreateWindowExW(
                    0,
                    label_class.as_ptr(),
                    text.as_ptr(),
                    WS_CHILD | WS_VISIBLE | SS_NOPREFIX,
                    scale(24),
                    scale(20),
                    scale(632),
                    scale(292),
                    window,
                    std::ptr::null_mut(),
                    instance,
                    std::ptr::null(),
                );
                let button_class = wide("BUTTON");
                let decline = wide("Decline");
                let no = CreateWindowExW(
                    0,
                    button_class.as_ptr(),
                    decline.as_ptr(),
                    WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON as u32,
                    scale(24),
                    scale(336),
                    scale(300),
                    scale(42),
                    window,
                    IDNO as usize as _,
                    instance,
                    std::ptr::null(),
                );
                let allow = wide("Allow viewing");
                let yes = CreateWindowExW(
                    0,
                    button_class.as_ptr(),
                    allow.as_ptr(),
                    WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON as u32,
                    scale(356),
                    scale(336),
                    scale(300),
                    scale(42),
                    window,
                    IDYES as usize as _,
                    instance,
                    std::ptr::null(),
                );
                if label.is_null()
                    || no.is_null()
                    || yes.is_null()
                    || SetTimer(window, 1, 100, None) == 0
                {
                    return Err(io::Error::last_os_error().into());
                }
                for child in [label, no, yes] {
                    SendMessageW(child, WM_SETFONT, font.0 as usize, 1);
                }
                // Recheck before showing: cancellation during initialization cannot
                // leave a stale request visible or permit a stale approval.
                if !state.live() {
                    return Ok(());
                }
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
                SetFocus(no);
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
                Ok(())
            })();
            if IsWindow(window) != 0 {
                DestroyWindow(window);
            }
            initialized?;
            Ok(state.accepted && state.live())
        })();
        UnregisterClassW(class.as_ptr(), instance);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
