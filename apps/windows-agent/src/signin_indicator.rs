//! Local disable UI owned by the scoped sign-in worker, never by Session 0.
use crate::{availability, signin_endpoint, signin_worker, HostError};
use std::{
    os::windows::io::AsRawHandle,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    Graphics::Gdi::{GetStockObject, COLOR_WINDOW, DEFAULT_GUI_FONT},
    System::{
        LibraryLoader::GetModuleHandleW, SystemServices::SS_NOPREFIX,
        Threading::WaitForSingleObject,
    },
    UI::{Input::KeyboardAndMouse::IsWindowEnabled, WindowsAndMessaging::*},
};
const DISABLE: usize = 1;
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
// Typed state only; no HWND, caller-selected text/command or credentials cross
// threads. The UI thread acknowledges only after its owned label is updated.
struct ControllerUpdate {
    controller: String,
    applied: mpsc::SyncSender<()>,
}
fn valid_controller(controller: &str) -> bool {
    !controller.trim().is_empty()
        && controller.len() <= 254
        && !controller.chars().any(|c| c.is_control()
            || matches!(c, '\u{200e}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
}
struct Ui {
    machine: String,
    stopped: Arc<AtomicBool>,
    disable_requested: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
    console: u32,
    label: HWND,
    button: HWND,
    updates: mpsc::Receiver<ControllerUpdate>,
}
unsafe fn apply_pending(state: &Ui) {
    let Ok(update) = state.updates.try_recv() else {
        return;
    };
    if state.stopped.load(Ordering::Acquire) || !valid_controller(&update.controller) {
        return;
    }
    let text = wide(&format!(
        "Authorized owner: {}\r\nWaiting for a secure connection.",
        update.controller
    ));
    if unsafe { SetWindowTextW(state.label, text.as_ptr()) } == 0 {
        state.stopped.store(true, Ordering::Release);
        return;
    }
    if state.stopped.load(Ordering::Acquire) || update.applied.send(()).is_err() {
        // A timed-out worker must never use a late UI acknowledgement.
        state.stopped.store(true, Ordering::Release);
    }
}
unsafe extern "system" fn procedure(window: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if message == WM_NCCREATE {
        if l == 0 {
            return 0;
        }
        let create = unsafe { &*(l as *const CREATESTRUCTW) };
        unsafe {
            SetWindowLongPtrW(window, GWLP_USERDATA, create.lpCreateParams as isize);
        }
    }
    let pointer = unsafe { GetWindowLongPtrW(window, GWLP_USERDATA) } as *mut Ui;
    if !pointer.is_null() {
        let state = unsafe { &*pointer };
        match message {
            WM_COMMAND if w & 0xffff == DISABLE => {
                unsafe {
                    disable(window, state);
                }
                return 0;
            }
            WM_CLOSE => {
                // The close button means disable, not hide a live worker.
                unsafe {
                    disable(window, state);
                }
                return 0;
            }
            WM_TIMER
                if state.closing.load(Ordering::Acquire)
                    || unsafe { IsWindowVisible(window) } == 0
                    || unsafe { IsWindowVisible(state.label) } == 0
                    || unsafe { IsWindowVisible(state.button) } == 0
                    || unsafe { IsWindowEnabled(state.button) } == 0
                    || !signin_worker::on_signin_desktop(state.console) =>
            {
                unsafe {
                    DestroyWindow(window);
                }
                return 0;
            }
            WM_DESTROY => {
                // Losing the control ends the current scope immediately; only
                // an explicit Disable/Close action lowers standing permission.
                state.stopped.store(true, Ordering::Release);
                state.alive.store(false, Ordering::Release);
                unsafe {
                    PostQuitMessage(0);
                }
                return 0;
            }
            WM_TIMER => {
                // The preceding timer arm verifies the actual visible window
                // and sign-in desktop before any positive acknowledgement.
                unsafe {
                    apply_pending(state);
                }
                return 0;
            }
            WM_SHOWWINDOW if w == 0 && state.alive.load(Ordering::Acquire) => {
                state.stopped.store(true, Ordering::Release);
            }
            _ => {}
        }
    }
    unsafe { DefWindowProcW(window, message, w, l) }
}
unsafe fn disable(window: HWND, state: &Ui) {
    // Capture/input adapters observe this flag immediately. Saving
    // the standing disable can fail; that never restores the active scope.
    state.disable_requested.store(true, Ordering::Release);
    state.stopped.store(true, Ordering::Release);
    if signin_endpoint::request_disable(&state.machine).is_ok() {
        unsafe {
            DestroyWindow(window);
        }
    } else {
        unsafe {
            SetWindowTextW(
                state.label,
                wide("Access stopped. Disable could not be saved. Try Disable again.").as_ptr(),
            );
        }
    }
}

pub(crate) struct Indicator {
    thread: Option<JoinHandle<()>>,
    stopped: Arc<AtomicBool>,
    disable_requested: Arc<AtomicBool>,
    alive: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
    updates: mpsc::SyncSender<ControllerUpdate>,
}
impl Indicator {
    pub(crate) fn show(machine: &str, console: u32) -> Result<Self, HostError> {
        if availability::current_sid()? != "S-1-5-18" || !signin_worker::on_signin_desktop(console)
        {
            return Err("Sign-in controls require the scoped Windows sign-in desktop".into());
        }
        let stopped = Arc::new(AtomicBool::new(false));
        let disable_requested = Arc::new(AtomicBool::new(false));
        let alive = Arc::new(AtomicBool::new(false));
        let closing = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::sync_channel(1);
        let (updates, update_receiver) = mpsc::sync_channel(1);
        // Ui's HWND is initialized/used only on its UI thread; construct it
        // there rather than sending a raw window pointer across threads.
        let machine = machine.to_string();
        let thread_stopped = stopped.clone();
        let thread_disable = disable_requested.clone();
        let thread_alive = alive.clone();
        let thread_closing = closing.clone();
        let thread = thread::Builder::new()
            .name("signin-local-stop".into())
            .spawn(move || {
                let mut state = Box::new(Ui {
                    machine,
                    stopped: thread_stopped,
                    disable_requested: thread_disable,
                    alive: thread_alive,
                    closing: thread_closing,
                    console,
                    label: null_mut(),
                    button: null_mut(),
                    updates: update_receiver,
                });
                let result = unsafe { create(console, &mut state) };
                match result {
                    Ok(window) => {
                        state.alive.store(true, Ordering::Release);
                        if sender.send(Ok(())).is_err() {
                            unsafe {
                                DestroyWindow(window);
                            }
                            return;
                        }
                        let mut message = MSG::default();
                        while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
                            if unsafe { IsDialogMessageW(window, &message) } != 0 {
                                continue;
                            }
                            unsafe {
                                TranslateMessage(&message);
                                DispatchMessageW(&message);
                            }
                        }
                        // Message-loop failure also closes the owned window while
                        // its user-data allocation is still alive.
                        unsafe {
                            if IsWindow(window) != 0 {
                                DestroyWindow(window);
                            }
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error.to_string()));
                    }
                }
                state.alive.store(false, Ordering::Release);
            })?;
        match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => (),
            Ok(Err(error)) => {
                closing.store(true, Ordering::Release);
                return Err(error.into());
            }
            Err(error) => {
                closing.store(true, Ordering::Release);
                return Err(error.into());
            }
        }
        Ok(Self {
            thread: Some(thread),
            stopped,
            disable_requested,
            alive,
            closing,
            updates,
        })
    }
    pub(crate) fn closed(&self) -> bool {
        !self.alive.load(Ordering::Acquire)
    }
    pub(crate) fn stop_requested(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }
    pub(crate) fn disable_requested(&self) -> bool {
        self.disable_requested.load(Ordering::Acquire)
    }
    pub(crate) fn stop_signal(&self) -> Arc<AtomicBool> {
        self.stopped.clone()
    }
    /// Close and join the owned UI before a terminal snapshot. A stalled UI
    /// cannot confirm retirement; its process/job still owns that thread.
    pub(crate) fn finish(&mut self) -> bool {
        self.closing.store(true, Ordering::Release);
        if let Some(thread) = self.thread.as_ref() {
            unsafe {
                WaitForSingleObject(thread.as_raw_handle(), 500);
            }
            if !thread.is_finished() {
                return false;
            }
        }
        self.thread
            .take()
            .is_none_or(|thread| thread.join().is_ok())
            && self.closed()
    }
    pub(crate) fn authorize(&self, controller: &str) -> Result<(), HostError> {
        self.authorize_with_timeout(controller, Duration::from_millis(400))
    }
    fn authorize_with_timeout(&self, controller: &str, timeout: Duration) -> Result<(), HostError> {
        let result = (|| {
            if !valid_controller(controller) || self.closed() || self.stop_requested() {
                return Err("Sign-in controller display unavailable".into());
            }
            let (applied, receiver) = mpsc::sync_channel(1);
            self.updates
                .try_send(ControllerUpdate {
                    controller: controller.into(),
                    applied,
                })
                .map_err(|_| "Sign-in controller display unavailable")?;
            receiver
                .recv_timeout(timeout)
                .map_err(|_| "Sign-in controller display unavailable")?;
            if self.closed() || self.stop_requested() {
                return Err("Sign-in controller display unavailable".into());
            }
            Ok(())
        })();
        if result.is_err() {
            self.stopped.store(true, Ordering::Release);
        }
        result
    }
}
impl Drop for Indicator {
    fn drop(&mut self) {
        // This thread observes its own close state; no stale HWND is posted to
        // after Windows might have reassigned it to an unrelated window.
        let _ = self.finish();
    }
}
unsafe fn create(console: u32, state: &mut Ui) -> Result<HWND, HostError> {
    if !signin_worker::on_signin_desktop(console) {
        return Err("The sign-in desktop changed".into());
    }
    unsafe { create_controls(state, true) }
}
// A hidden current-user fixture exercises only our own window procedures. The
// production entry remains guarded by SYSTEM, console and input-desktop checks.
unsafe fn create_controls(state: &mut Ui, visible: bool) -> Result<HWND, HostError> {
    let instance = unsafe { GetModuleHandleW(null()) };
    let class = wide("BeaconRemote.SignIn.LocalStop");
    let definition = WNDCLASSW {
        lpfnWndProc: Some(procedure),
        hInstance: instance,
        hCursor: unsafe { LoadCursorW(null_mut(), IDC_ARROW) },
        hbrBackground: (COLOR_WINDOW + 1) as _,
        lpszClassName: class.as_ptr(),
        ..Default::default()
    };
    if unsafe { RegisterClassW(&definition) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let window = unsafe {
        CreateWindowExW(
            WS_EX_TOPMOST,
            class.as_ptr(),
            wide("Beacon Remote · sign-in access").as_ptr(),
            WS_CAPTION | WS_SYSMENU | WS_POPUP,
            ((GetSystemMetrics(SM_CXSCREEN) - 720) / 2).max(0),
            16,
            720,
            200,
            null_mut(),
            null_mut(),
            instance,
            (state as *mut Ui).cast(),
        )
    };
    if window.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    let label = unsafe {
        CreateWindowExW(
            0,
            wide("STATIC").as_ptr(),
            wide("Screen sharing is unavailable in this development build.").as_ptr(),
            WS_CHILD | WS_VISIBLE | SS_NOPREFIX,
            12,
            12,
            550,
            140,
            window,
            null_mut(),
            instance,
            null(),
        )
    };
    let button = unsafe {
        CreateWindowExW(
            0,
            wide("BUTTON").as_ptr(),
            wide("Disable").as_ptr(),
            WS_CHILD | WS_VISIBLE | WS_TABSTOP,
            596,
            12,
            96,
            32,
            window,
            DISABLE as _,
            instance,
            null(),
        )
    };
    if label.is_null() || button.is_null() {
        unsafe {
            DestroyWindow(window);
        }
        return Err("Could not create the local sign-in disable control".into());
    }
    state.label = label;
    state.button = button;
    if unsafe { SetTimer(window, 1, 100, None) } == 0 {
        unsafe {
            DestroyWindow(window);
        }
        return Err("Could not supervise local sign-in controls".into());
    }
    let font = unsafe { GetStockObject(DEFAULT_GUI_FONT) };
    unsafe {
        SendMessageW(label, WM_SETFONT, font as usize, 1);
        SendMessageW(button, WM_SETFONT, font as usize, 1);
        if visible {
            ShowWindow(window, SW_SHOWNOACTIVATE);
        }
    }
    Ok(window)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_ui_join_observes_final_disable_and_cannot_confirm_a_live_thread() {
        for stalled in [false, true] {
            let (updates, _receiver) = mpsc::sync_channel(1);
            let stopped = Arc::new(AtomicBool::new(false));
            let disable = Arc::new(AtomicBool::new(false));
            let alive = Arc::new(AtomicBool::new(true));
            let closing = Arc::new(AtomicBool::new(false));
            let (release, wait) = mpsc::sync_channel(1);
            let closed = closing.clone();
            let final_disable = disable.clone();
            let final_alive = alive.clone();
            let thread = thread::spawn(move || {
                while !closed.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_millis(1));
                }
                if stalled {
                    wait.recv_timeout(Duration::from_secs(3)).unwrap();
                }
                final_disable.store(true, Ordering::Release);
                final_alive.store(false, Ordering::Release);
            });
            let mut indicator = Indicator {
                thread: Some(thread),
                stopped,
                disable_requested: disable,
                alive,
                closing,
                updates,
            };
            if stalled {
                assert!(!indicator.finish());
                assert!(indicator.thread.is_some());
                assert!(!indicator.closed());
                release.send(()).unwrap();
            }
            assert!(indicator.finish());
            assert!(indicator.closed());
            assert!(indicator.disable_requested());
            assert!(indicator.thread.is_none());
            assert!(indicator.finish());
        }
    }
    #[test]
    fn ordinary_identity_or_desktop_cannot_open_privileged_signin_controls() {
        assert!(Indicator::show(&uuid::Uuid::new_v4().to_string(), 0).is_err());
        assert!(Indicator::show(&uuid::Uuid::new_v4().to_string(), u32::MAX).is_err());
    }
    #[test]
    fn controller_display_failure_latches_stop_and_rejects_misleading_text() {
        for controller in [
            "",
            "   ",
            "owner\nadmin",
            "owner\u{202e}admin",
            "owner\u{2066}admin",
        ] {
            assert!(!valid_controller(controller));
        }
        assert!(!valid_controller(&"a".repeat(255)));
        let (updates, receiver) = mpsc::sync_channel(1);
        let indicator = Indicator {
            thread: None,
            stopped: Arc::new(AtomicBool::new(false)),
            disable_requested: Arc::new(AtomicBool::new(false)),
            alive: Arc::new(AtomicBool::new(true)),
            closing: Arc::new(AtomicBool::new(false)),
            updates,
        };
        // No UI consumes/acknowledges the queued update. A timeout irrevocably
        // ends this worker's scope, even if the UI later handles that request.
        assert!(indicator
            .authorize_with_timeout("owner@example.test", Duration::from_millis(1))
            .is_err());
        assert!(indicator.stop_requested());
        assert!(!indicator.disable_requested());
        let late = receiver.try_recv().unwrap();
        assert!(late.applied.send(()).is_err());
        assert!(indicator.authorize("owner@example.test").is_err());
    }
    #[test]
    fn close_and_disable_retain_retry_control_when_saving_fails() {
        let (updates, receiver) = mpsc::sync_channel(1);
        let mut state = Box::new(Ui {
            // An invalid fixed test identifier is rejected before any installed
            // path/file/service is inspected or changed by the disable request.
            machine: "not-an-installed-machine".into(),
            console: 0,
            stopped: Arc::new(AtomicBool::new(false)),
            disable_requested: Arc::new(AtomicBool::new(false)),
            alive: Arc::new(AtomicBool::new(true)),
            closing: Arc::new(AtomicBool::new(false)),
            label: null_mut(),
            button: null_mut(),
            updates: receiver,
        });
        let window = unsafe { create_controls(&mut state, false) }.unwrap();
        assert_eq!(unsafe { IsWindowVisible(window) }, 0);
        let (applied, acknowledged) = mpsc::sync_channel(1);
        updates
            .send(ControllerUpdate {
                controller: "owner&fixture@example.test".into(),
                applied,
            })
            .unwrap();
        unsafe {
            apply_pending(&state);
        }
        acknowledged
            .recv_timeout(Duration::from_millis(100))
            .unwrap();
        let mut text = [0u16; 512];
        let count = unsafe { GetWindowTextW(state.label, text.as_mut_ptr(), text.len() as i32) };
        let text = String::from_utf16_lossy(&text[..count as usize]);
        assert!(
            text.contains("owner&fixture@example.test")
                && text.contains("Waiting for a secure connection")
        );
        for (message, w) in [(WM_CLOSE, 0), (WM_COMMAND, DISABLE)] {
            unsafe {
                SendMessageW(window, message, w, 0);
            }
            assert!(state.stopped.load(Ordering::Acquire));
            assert!(state.disable_requested.load(Ordering::Acquire));
            assert!(state.alive.load(Ordering::Acquire));
            assert_ne!(unsafe { IsWindow(window) }, 0);
            let mut text = [0u16; 256];
            let count =
                unsafe { GetWindowTextW(state.label, text.as_mut_ptr(), text.len() as i32) };
            assert!(
                String::from_utf16_lossy(&text[..count as usize]).contains("could not be saved")
            );
        }
        let (applied, acknowledged) = mpsc::sync_channel(1);
        updates
            .send(ControllerUpdate {
                controller: "late-owner@example.test".into(),
                applied,
            })
            .unwrap();
        unsafe {
            apply_pending(&state);
        }
        assert!(acknowledged
            .recv_timeout(Duration::from_millis(100))
            .is_err());
        let mut text = [0u16; 256];
        let count = unsafe { GetWindowTextW(state.label, text.as_mut_ptr(), text.len() as i32) };
        assert!(String::from_utf16_lossy(&text[..count as usize]).contains("could not be saved"));
        state.closing.store(true, Ordering::Release);
        unsafe {
            SendMessageW(window, WM_TIMER, 1, 0);
        }
        assert!(!state.alive.load(Ordering::Acquire));
        assert!(state.stopped.load(Ordering::Acquire));
        assert_eq!(unsafe { IsWindow(window) }, 0);
        unsafe {
            UnregisterClassW(
                wide("BeaconRemote.SignIn.LocalStop").as_ptr(),
                GetModuleHandleW(null()),
            );
        }
    }
}
