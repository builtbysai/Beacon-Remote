//! Native visible stop control. The window thread owns its atomic state lifetime.
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
};
use windows_sys::Win32::Graphics::Gdi::{GetStockObject, DEFAULT_GUI_FONT};
use windows_sys::Win32::System::SystemServices::SS_NOPREFIX;
use windows_sys::Win32::UI::HiDpi::GetDpiForSystem;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows_sys::Win32::{System::LibraryLoader::GetModuleHandleW, UI::WindowsAndMessaging::*};
type Error = Box<dyn std::error::Error + Send + Sync>;
struct WindowState {
    active: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    desktop: bool,
}
pub struct Indicator {
    active: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
unsafe extern "system" fn procedure(
    window: windows_sys::Win32::Foundation::HWND,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if message == WM_NCCREATE {
        let creation = &*(lparam as *const CREATESTRUCTW);
        SetWindowLongPtrW(window, GWLP_USERDATA, creation.lpCreateParams as isize);
    }
    let state = GetWindowLongPtrW(window, GWLP_USERDATA) as *const WindowState;
    if (message == WM_COMMAND && (wparam & 0xffff) == 1001) || message == WM_CLOSE {
        if !state.is_null() {
            (*state).active.store(false, Ordering::Release);
        }
        DestroyWindow(window);
        return 0;
    }
    if message == WM_TIMER && !state.is_null() {
        if !(*state).active.load(Ordering::Acquire) {
            DestroyWindow(window);
            return 0;
        }
        let text = wide(if (*state).connected.load(Ordering::Acquire) {
            if (*state).desktop {
                "Connected — desktop sharing · View only"
            } else {
                "Connected — synthetic video only"
            }
        } else {
            "Connecting — waiting for the browser"
        });
        SetWindowTextW(GetDlgItem(window, 1002), text.as_ptr());
    }
    if message == WM_DESTROY {
        KillTimer(window, 1);
        PostQuitMessage(0);
        return 0;
    }
    DefWindowProcW(window, message, wparam, lparam)
}
impl Indicator {
    pub fn start(
        active: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
        desktop: bool,
        controller: String,
    ) -> Result<Self, Error> {
        let (ready, received) = mpsc::channel();
        let state = Arc::new(WindowState {
            active: active.clone(),
            connected,
            desktop,
        });
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
                    let definition = WNDCLASSW {
                        lpfnWndProc: Some(procedure),
                        hInstance: instance,
                        lpszClassName: class.as_ptr(),
                        hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
                        ..Default::default()
                    };
                    if RegisterClassW(&definition) == 0 {
                        return Err(io::Error::last_os_error().into());
                    }
                    let title = wide(if desktop {
                        "Beacon Remote — attended desktop view"
                    } else {
                        "Beacon Remote — synthetic video test (no desktop)"
                    });
                    let window = CreateWindowExW(
                        WS_EX_TOPMOST,
                        class.as_ptr(),
                        title.as_ptr(),
                        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
                        CW_USEDEFAULT,
                        CW_USEDEFAULT,
                        scale(640),
                        scale(310),
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
                    let details = wide(&format!("Beacon Remote\nController: {controller}\nView only · Ends within two minutes\nMicrophone, recording and remote input are disabled."));
                    let identity = CreateWindowExW(
                        0,
                        label.as_ptr(),
                        details.as_ptr(),
                        WS_CHILD | WS_VISIBLE | SS_NOPREFIX,
                        scale(24),
                        scale(16),
                        scale(580),
                        scale(100),
                        window,
                        std::ptr::null_mut(),
                        instance,
                        std::ptr::null(),
                    );
                    let status = wide("Connecting — waiting for the browser");
                    let status_control = CreateWindowExW(
                        0,
                        label.as_ptr(),
                        status.as_ptr(),
                        WS_CHILD | WS_VISIBLE | SS_NOPREFIX,
                        scale(24),
                        scale(124),
                        scale(580),
                        scale(30),
                        window,
                        1002usize as _,
                        instance,
                        std::ptr::null(),
                    );
                    let button = wide("BUTTON");
                    let caption = wide(if desktop {
                        "Stop sharing now"
                    } else {
                        "Stop video test"
                    });
                    let control = CreateWindowExW(
                        0,
                        button.as_ptr(),
                        caption.as_ptr(),
                        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON as u32,
                        scale(24),
                        scale(174),
                        scale(580),
                        scale(55),
                        window,
                        1001usize as _,
                        instance,
                        std::ptr::null(),
                    );
                    if identity.is_null()
                        || status_control.is_null()
                        || control.is_null()
                        || SetTimer(window, 1, 100, None) == 0
                    {
                        DestroyWindow(window);
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err(io::Error::last_os_error().into());
                    }
                    ShowWindow(window, SW_SHOW);
                    let font = GetStockObject(DEFAULT_GUI_FONT);
                    if !font.is_null() {
                        for child in [identity, status_control, control] {
                            SendMessageW(child, WM_SETFONT, font as usize, 1);
                        }
                    }
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
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                    state.active.store(false, Ordering::Release);
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
