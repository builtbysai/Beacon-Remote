//! Native visible stop control. The window thread owns its atomic state lifetime.
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Instant,
};
use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::Graphics::Gdi::COLOR_WINDOW;
use windows_sys::Win32::System::SystemServices::SS_NOPREFIX;
use windows_sys::Win32::UI::HiDpi::GetDpiForSystem;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows_sys::Win32::{System::LibraryLoader::GetModuleHandleW, UI::WindowsAndMessaging::*};
type Error = Box<dyn std::error::Error + Send + Sync>;
const STOP_ID: i32 = 1001;
const STATUS_ID: i32 = 1002;
struct WindowState {
    active: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    desktop: bool,
    control: bool,
    deadline: Instant,
}
impl WindowState {
    fn live(&self) -> bool {
        self.active.load(Ordering::Acquire)
            && Instant::now() < self.deadline
            && (!self.desktop || crate::capture::desktop_receives_input())
    }
}
pub struct Indicator {
    active: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
unsafe fn dispatch(window: windows_sys::Win32::Foundation::HWND, message: &MSG) {
    if IsDialogMessageW(window, message) == 0 {
        TranslateMessage(message);
        DispatchMessageW(message);
    }
}
unsafe extern "system" fn procedure(
    window: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if message == WM_CTLCOLORSTATIC {
        return crate::window_style::static_background(wparam);
    }
    if message == WM_NCCREATE {
        let creation = &*(lparam as *const CREATESTRUCTW);
        SetWindowLongPtrW(window, GWLP_USERDATA, creation.lpCreateParams as isize);
    }
    let state = GetWindowLongPtrW(window, GWLP_USERDATA) as *const WindowState;
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
        let remaining = (*state).deadline.saturating_duration_since(Instant::now());
        let seconds = remaining.as_secs() + u64::from(remaining.subsec_nanos() > 0);
        let status = if (*state).connected.load(Ordering::Acquire) {
            if (*state).desktop {
                if (*state).control {
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
        let text = wide(&format!(
            "{status} · {}:{:02} left",
            seconds / 60,
            seconds % 60
        ));
        let control = GetDlgItem(window, STATUS_ID);
        let mut current = [0_u16; 128];
        let length = GetWindowTextW(control, current.as_mut_ptr(), current.len() as i32).max(0);
        // Keep the fast safety timer, but only repaint/announce a changed status
        // or whole second instead of resetting accessible text ten times a second.
        if current[..length as usize] != text[..text.len() - 1] {
            SetWindowTextW(control, text.as_ptr());
        }
    }
    if message == DM_GETDEFID {
        return ((DC_HASDEFID as usize) << 16 | STOP_ID as usize) as isize;
    }
    if message == DM_SETDEFID {
        return (wparam == STOP_ID as usize) as isize;
    }
    if message == WM_DESTROY {
        if !state.is_null() {
            (*state).active.store(false, Ordering::Release);
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
    pub fn start_access(
        active: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
        desktop: bool,
        controller: String,
        deadline: Instant,
        control: bool,
    ) -> Result<Self, Error> {
        let (ready, received) = mpsc::channel();
        let state = Arc::new(WindowState {
            active: active.clone(),
            connected,
            desktop,
            control,
            deadline,
        });
        if !state.live() {
            active.store(false, Ordering::Release);
            return Err("View expired, stopped or input desktop unavailable".into());
        }
        let thread = thread::spawn(move || {
            let result = (|| -> Result<(), Error> {
                unsafe {
                    let instance = GetModuleHandleW(std::ptr::null());
                    if instance.is_null() {
                        return Err(io::Error::last_os_error().into());
                    }
                    let class = wide("BeaconRemoteVisibleStop");
                    let dpi = GetDpiForSystem().max(96) as i32;
                    let scale = |value: i32| value * dpi / 96;
                    let font = crate::window_style::Font::new(scale(16))?;
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
                    let title = wide(if desktop {
                        "Beacon Remote — screen sharing"
                    } else {
                        "Beacon Remote — synthetic video test (no desktop)"
                    });
                    let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU;
                    let mut bounds = RECT {
                        left: 0,
                        top: 0,
                        right: scale(560),
                        bottom: scale(204),
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
                    let label = wide("STATIC");
                    let controller = controller
                        .chars()
                        .filter(|character| !character.is_control())
                        .collect::<String>();
                    let details = wide("Viewer");
                    let identity = CreateWindowExW(
                        0,
                        label.as_ptr(),
                        details.as_ptr(),
                        WS_CHILD | WS_VISIBLE | SS_NOPREFIX,
                        scale(24),
                        scale(20),
                        scale(512),
                        scale(24),
                        window,
                        std::ptr::null_mut(),
                        instance,
                        std::ptr::null(),
                    );
                    let requester = CreateWindowExW(
                        0,
                        wide("EDIT").as_ptr(),
                        wide(&controller).as_ptr(),
                        WS_CHILD
                            | WS_VISIBLE
                            | WS_TABSTOP
                            | ES_READONLY as u32
                            | ES_AUTOHSCROLL as u32,
                        scale(24),
                        scale(48),
                        scale(512),
                        scale(28),
                        window,
                        std::ptr::null_mut(),
                        instance,
                        std::ptr::null(),
                    );
                    let status = wide("Connecting to viewer");
                    let status_control = CreateWindowExW(
                        0,
                        label.as_ptr(),
                        status.as_ptr(),
                        WS_CHILD | WS_VISIBLE | SS_NOPREFIX,
                        scale(24),
                        scale(96),
                        scale(512),
                        scale(28),
                        window,
                        STATUS_ID as usize as _,
                        instance,
                        std::ptr::null(),
                    );
                    let button = wide("BUTTON");
                    let caption = wide(if desktop {
                        "Stop sharing"
                    } else {
                        "Stop video test"
                    });
                    let control = CreateWindowExW(
                        0,
                        button.as_ptr(),
                        caption.as_ptr(),
                        WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON as u32,
                        scale(24),
                        scale(144),
                        scale(512),
                        scale(40),
                        window,
                        STOP_ID as usize as _,
                        instance,
                        std::ptr::null(),
                    );
                    if identity.is_null()
                        || requester.is_null()
                        || status_control.is_null()
                        || control.is_null()
                        || SetTimer(window, 1, 100, None) == 0
                    {
                        DestroyWindow(window);
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err(io::Error::last_os_error().into());
                    }
                    if !state.live() {
                        DestroyWindow(window);
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err("View expired, stopped or input desktop unavailable".into());
                    }
                    for child in [identity, requester, status_control, control] {
                        SendMessageW(child, WM_SETFONT, font.0 as usize, 1);
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
                    SetFocus(control);
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
                    if IsWindow(window) != 0 {
                        DestroyWindow(window);
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
        deadline: Instant,
    ) -> HiddenWindow {
        let state = Box::new(WindowState {
            active: Arc::new(AtomicBool::new(true)),
            connected: Arc::new(AtomicBool::new(false)),
            desktop,
            control: false,
            deadline,
        });
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
                    let fixture = hidden_window(instance, &name, capture, deadline);
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
                        Instant::now() + Duration::from_secs(5),
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
}
