//! Native visible stop control. The window thread owns its atomic state lifetime.
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
};
use windows_sys::Win32::{System::LibraryLoader::GetModuleHandleW, UI::WindowsAndMessaging::*};
type Error = Box<dyn std::error::Error + Send + Sync>;
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
    let state = GetWindowLongPtrW(window, GWLP_USERDATA) as *const AtomicBool;
    if (message == WM_COMMAND && (wparam & 0xffff) == 1001) || message == WM_CLOSE {
        if !state.is_null() {
            (*state).store(false, Ordering::Release);
        }
        DestroyWindow(window);
        return 0;
    }
    if message == WM_TIMER && !state.is_null() && !(*state).load(Ordering::Acquire) {
        DestroyWindow(window);
        return 0;
    }
    if message == WM_DESTROY {
        KillTimer(window, 1);
        PostQuitMessage(0);
        return 0;
    }
    DefWindowProcW(window, message, wparam, lparam)
}
impl Indicator {
    pub fn start(active: Arc<AtomicBool>, desktop: bool) -> Result<Self, Error> {
        let (ready, received) = mpsc::channel();
        let state = active.clone();
        let thread = thread::spawn(move || {
            let result = (|| -> Result<(), Error> {
                unsafe {
                    let instance = GetModuleHandleW(std::ptr::null());
                    if instance.is_null() {
                        return Err(io::Error::last_os_error().into());
                    }
                    let class = wide("BeaconRemoteVisibleStop");
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
                        "Beacon Remote — DESKTOP SHARING ACTIVE"
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
                        480,
                        160,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        instance,
                        Arc::as_ptr(&state).cast(),
                    );
                    if window.is_null() {
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err(io::Error::last_os_error().into());
                    }
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
                        30,
                        30,
                        410,
                        55,
                        window,
                        1001usize as _,
                        instance,
                        std::ptr::null(),
                    );
                    if control.is_null() || SetTimer(window, 1, 100, None) == 0 {
                        DestroyWindow(window);
                        UnregisterClassW(class.as_ptr(), instance);
                        return Err(io::Error::last_os_error().into());
                    }
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
                    state.store(false, Ordering::Release);
                    UnregisterClassW(class.as_ptr(), instance);
                    Ok(())
                }
            })();
            if let Err(error) = result {
                state.store(false, Ordering::Release);
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
