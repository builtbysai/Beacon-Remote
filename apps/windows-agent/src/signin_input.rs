//! Sign-in input is separate from the ordinary desktop adapter. No clipboard,
//! commands, desktop switching, UIAccess, token borrowing or SAS key emulation.
//! Secure attention is a separate fixed-purpose service request after key release.
use crate::{
    signin_scope::{self, SignInScope, TICKS_PER_MILLISECOND as T},
    HostError,
};
use beacon_remote_core::{Display, Input, MouseButton};
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    os::windows::io::AsRawHandle,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::POINT,
    Graphics::Gdi::*,
    System::Threading::WaitForSingleObject,
    UI::{HiDpi::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};
use zeroize::{Zeroize, Zeroizing};

const MAX_MESSAGE: usize = 4096;
const IDLE: u64 = 1500 * T;
const CLEANUP: u64 = 3000 * T;
const SILENCE: u64 = 30_000 * T;
/// Shift, Ctrl, Alt and the Windows keys: the only keys a person holds down on the sign-in screen.
fn modifier(scan_code: u16, extended: bool) -> bool {
    matches!(
        (scan_code, extended),
        (0x2a | 0x36 | 0x1d | 0x38, _) | (0x5b | 0x5c, true)
    )
}
fn rejected() -> HostError {
    "Sign-in input unavailable or rejected".into()
}
struct Dpi(DPI_AWARENESS_CONTEXT);
impl Dpi {
    fn physical() -> Result<Self, HostError> {
        let previous =
            unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        if previous.is_null() {
            return Err(rejected());
        }
        Ok(Self(previous))
    }
}
impl Drop for Dpi {
    fn drop(&mut self) {
        unsafe {
            SetThreadDpiAwarenessContext(self.0);
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
struct Layout {
    device: [u16; 32],
    monitor: usize,
    left: i32,
    top: i32,
    width: u32,
    height: u32,
    virtual_left: i32,
    virtual_top: i32,
    virtual_width: i32,
    virtual_height: i32,
    rotation: u32,
}
impl Layout {
    fn read() -> Result<Self, HostError> {
        let _dpi = Dpi::physical()?;
        let monitor = unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) };
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of_val(&info) as u32;
        if monitor.is_null()
            || unsafe { GetMonitorInfoW(monitor, (&mut info as *mut MONITORINFOEXW).cast()) } == 0
            || info.monitorInfo.dwFlags & 1 == 0
        {
            return Err(rejected());
        }
        let mut mode = DEVMODEW {
            dmSize: std::mem::size_of::<DEVMODEW>() as u16,
            ..Default::default()
        };
        if unsafe { EnumDisplaySettingsW(info.szDevice.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) }
            == 0
            || mode.dmFields & DM_DISPLAYORIENTATION == 0
        {
            return Err(rejected());
        }
        let rect = info.monitorInfo.rcMonitor;
        let layout = Self {
            device: info.szDevice,
            monitor: monitor as usize,
            left: rect.left,
            top: rect.top,
            width: rect
                .right
                .checked_sub(rect.left)
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(rejected)?,
            height: rect
                .bottom
                .checked_sub(rect.top)
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(rejected)?,
            virtual_left: unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) },
            virtual_top: unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) },
            virtual_width: unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) },
            virtual_height: unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) },
            rotation: unsafe { mode.Anonymous1.Anonymous2.dmDisplayOrientation },
        };
        if layout.width == 0
            || layout.height == 0
            || layout.rotation > 3
            || mode.dmPelsWidth != layout.width
            || mode.dmPelsHeight != layout.height
        {
            return Err(rejected());
        }
        layout.pointer(0, 0)?;
        layout.pointer(layout.width - 1, layout.height - 1)?;
        Ok(layout)
    }
    fn pointer(&self, x: u32, y: u32) -> Result<(i32, i32), HostError> {
        if x >= self.width || y >= self.height {
            return Err(rejected());
        }
        Ok((
            axis(
                self.left as i64 + x as i64 - self.virtual_left as i64,
                self.virtual_width,
            )?,
            axis(
                self.top as i64 + y as i64 - self.virtual_top as i64,
                self.virtual_height,
            )?,
        ))
    }
    fn display(&self) -> Display {
        Display {
            id: crate::signin_capture::DISPLAY.into(),
            width: self.width,
            height: self.height,
            origin_x: self.left,
            origin_y: self.top,
            scale: 1.0,
        }
    }
}
fn axis(pixel: i64, size: i32) -> Result<i32, HostError> {
    if size <= 0 || size > 65536 || pixel < 0 || pixel >= size as i64 {
        return Err(rejected());
    }
    // Center of the pixel's normalized absolute-input bin, not a CSS coordinate.
    Ok(((2 * pixel + 1) * 65536 / (2 * size as i64)).min(65535) as i32)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Event {
    Pointer(i32, i32),
    Button(MouseButton, bool),
    Scroll(i32, bool),
    Scan(u16, bool, bool),
    Unicode(u16, bool),
}
trait Sink: Send {
    fn layout(&self) -> Result<Layout, HostError>;
    fn send(&mut self, event: Event) -> Result<(), HostError>;
}
trait Gate: Send + Sync {
    fn live(&self) -> bool;
    fn cleanup(&self) -> bool;
    fn stop(&self);
}
impl Gate for SignInScope {
    fn live(&self) -> bool {
        self.authorize().is_ok()
    }
    fn cleanup(&self) -> bool {
        self.release_allowed()
    }
    fn stop(&self) {
        SignInScope::stop(self);
    }
}
struct WindowsSink;
impl Sink for WindowsSink {
    fn layout(&self) -> Result<Layout, HostError> {
        Layout::read()
    }
    fn send(&mut self, event: Event) -> Result<(), HostError> {
        let mut input = INPUT::default();
        let _dpi = if matches!(event, Event::Pointer(..)) {
            Some(Dpi::physical()?)
        } else {
            None
        };
        match event {
            Event::Pointer(x, y) => {
                input.r#type = INPUT_MOUSE;
                input.Anonymous.mi = MOUSEINPUT {
                    dx: x,
                    dy: y,
                    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                    ..Default::default()
                };
            }
            Event::Button(button, down) => {
                let flags = match (button, down) {
                    (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
                    (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
                    (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
                    (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
                    (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
                    (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
                };
                input.r#type = INPUT_MOUSE;
                input.Anonymous.mi = MOUSEINPUT {
                    dwFlags: flags,
                    ..Default::default()
                };
            }
            Event::Scroll(amount, horizontal) => {
                input.r#type = INPUT_MOUSE;
                input.Anonymous.mi = MOUSEINPUT {
                    mouseData: amount as u32,
                    dwFlags: if horizontal {
                        MOUSEEVENTF_HWHEEL
                    } else {
                        MOUSEEVENTF_WHEEL
                    },
                    ..Default::default()
                };
            }
            Event::Scan(scan, extended, down) => {
                input.r#type = INPUT_KEYBOARD;
                input.Anonymous.ki = KEYBDINPUT {
                    wScan: scan,
                    dwFlags: KEYEVENTF_SCANCODE
                        | if extended { KEYEVENTF_EXTENDEDKEY } else { 0 }
                        | if down { 0 } else { KEYEVENTF_KEYUP },
                    ..Default::default()
                };
            }
            Event::Unicode(unit, down) => {
                input.r#type = INPUT_KEYBOARD;
                input.Anonymous.ki = KEYBDINPUT {
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | if down { 0 } else { KEYEVENTF_KEYUP },
                    ..Default::default()
                };
            }
        }
        if unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) } != 1 {
            return Err(rejected());
        }
        Ok(())
    }
}
struct Tracked<S: Sink> {
    sink: S,
    gate: Arc<dyn Gate>,
    layout: Layout,
    keys: BTreeSet<(u16, bool)>,
    /// Modifiers the viewer holds. They are pressed only around each key tap, never left down on the sign-in desktop.
    modifiers: BTreeSet<(u16, bool)>,
    buttons: BTreeSet<MouseButton>,
    unicode: BTreeSet<u16>,
    sequence: u64,
    activity: u64,
    ended: Option<u64>,
}
impl<S: Sink> Tracked<S> {
    fn new(sink: S, gate: Arc<dyn Gate>, now: u64) -> Result<Self, HostError> {
        let layout = sink.layout()?;
        Ok(Self {
            sink,
            gate,
            layout,
            keys: BTreeSet::new(),
            modifiers: BTreeSet::new(),
            buttons: BTreeSet::new(),
            unicode: BTreeSet::new(),
            sequence: 0,
            activity: now,
            ended: None,
        })
    }
    fn held(&self) -> bool {
        !self.keys.is_empty() || !self.buttons.is_empty() || !self.unicode.is_empty()
    }
    fn release(&mut self) {
        if !self.gate.cleanup() {
            return;
        }
        // Only successful key-ups relinquish cleanup ownership. Never send a
        // fresh down event while retrying a failed or partially completed send.
        self.keys.retain(|&(scan, ext)| {
            !self.gate.cleanup() || self.sink.send(Event::Scan(scan, ext, false)).is_err()
        });
        self.buttons.retain(|&button| {
            !self.gate.cleanup() || self.sink.send(Event::Button(button, false)).is_err()
        });
        self.unicode.retain(|&unit| {
            !self.gate.cleanup() || self.sink.send(Event::Unicode(unit, false)).is_err()
        });
    }
    fn end(&mut self, now: u64) {
        self.ended.get_or_insert(now);
        self.gate.stop();
        self.release();
    }
    fn live_send(&mut self, event: Event) -> Result<(), HostError> {
        if !self.gate.live() || self.sink.layout()? != self.layout {
            return Err(rejected());
        }
        self.sink.send(event)?;
        if !self.gate.live() {
            return Err(rejected());
        }
        Ok(())
    }
    fn process(&mut self, sequence: u64, input: &Input, now: u64) -> Result<(), HostError> {
        let result = (|| {
            if self.ended.is_some()
                || sequence == 0
                || sequence <= self.sequence
                || !self.gate.live()
            {
                return Err(rejected());
            }
            input.validate().map_err(|_| rejected())?;
            if matches!(input, Input::ClipboardRead) {
                return Err(rejected());
            }
            if self.sink.layout()? != self.layout {
                return Err(rejected());
            }
            self.sequence = sequence;
            self.activity = now;
            match input {
                Input::MovePointer { display_id, x, y } => {
                    if display_id != crate::signin_capture::DISPLAY {
                        return Err(rejected());
                    }
                    let (x, y) = self.layout.pointer(*x, *y)?;
                    self.live_send(Event::Pointer(x, y))?;
                }
                Input::Key {
                    scan_code,
                    extended,
                    down,
                } => {
                    let key = (*scan_code, *extended);
                    if modifier(*scan_code, *extended) {
                        // Shift, Ctrl, Alt and Windows are remembered, not pressed: a password screen never needs one
                        // held on its own, and nothing may be left down when Windows leaves this desktop on sign-in.
                        if *down {
                            self.modifiers.insert(key);
                        } else {
                            self.modifiers.remove(&key);
                        }
                    } else if *down {
                        // Every other key is one complete step, sent when it goes down, with the remembered modifiers
                        // around it; its later key-up is ignored. Enter submits the password on key-down and Windows
                        // leaves this desktop before the key-up arrives.
                        let around: Vec<_> = self.modifiers.iter().copied().collect();
                        for &(scan, ext) in &around {
                            self.keys.insert((scan, ext));
                            self.live_send(Event::Scan(scan, ext, true))?;
                        }
                        self.keys.insert(key);
                        self.live_send(Event::Scan(key.0, key.1, true))?;
                        self.live_send(Event::Scan(key.0, key.1, false))?;
                        self.keys.remove(&key);
                        for &(scan, ext) in around.iter().rev() {
                            self.live_send(Event::Scan(scan, ext, false))?;
                            self.keys.remove(&(scan, ext));
                        }
                    } else if self.keys.contains(&(*scan_code, *extended)) {
                        self.live_send(Event::Scan(*scan_code, *extended, false))?;
                        self.keys.remove(&(*scan_code, *extended));
                    }
                }
                Input::Button { button, down } => {
                    if *down {
                        self.buttons.insert(*button);
                        self.live_send(Event::Button(*button, true))?;
                    } else if self.buttons.contains(button) {
                        self.live_send(Event::Button(*button, false))?;
                        self.buttons.remove(button);
                    }
                }
                Input::Scroll {
                    horizontal,
                    vertical,
                } => {
                    if *horizontal != 0 {
                        self.live_send(Event::Scroll(*horizontal, true))?;
                    }
                    if *vertical != 0 {
                        self.live_send(Event::Scroll(*vertical, false))?;
                    }
                }
                Input::TypeText { text } => {
                    for unit in text.encode_utf16() {
                        self.unicode.insert(unit);
                        self.live_send(Event::Unicode(unit, true))?;
                        self.live_send(Event::Unicode(unit, false))?;
                        self.unicode.remove(&unit);
                        thread::sleep(Duration::from_millis(4));
                    }
                }
                Input::ReleaseAll => {
                    self.release();
                    if self.held() {
                        return Err(rejected());
                    }
                }
                Input::KeepAlive => (),
                Input::ClipboardRead => return Err(rejected()),
            }
            Ok(())
        })();
        if result.is_err() {
            self.end(now);
        }
        result
    }
    // Returns true once an ended scope has completed cleanup or exhausted its
    // bounded retry window. The latter remains explicitly unconfirmed.
    fn poll(&mut self, now: u64) -> bool {
        if !self.gate.live() || now.saturating_sub(self.activity) >= SILENCE {
            self.end(now);
        }
        if let Some(ended) = self.ended {
            self.release();
            return !self.held() || now.saturating_sub(ended) >= CLEANUP;
        }
        if now.saturating_sub(self.activity) >= IDLE {
            self.release();
            if self.held() {
                self.end(now);
            }
        }
        false
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SignInEvent {
    Input(Input),
    Attention(AttentionInput),
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum AttentionInput {
    SecureAttention {},
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Command {
    version: u8,
    scope: String,
    lease_id: String,
    instance_id: String,
    console_session_id: u32,
    sequence: u64,
    input: SignInEvent,
}
impl Command {
    fn decode(bytes: &[u8]) -> Result<Self, HostError> {
        if bytes.len() > MAX_MESSAGE {
            return Err(rejected());
        }
        let command: Self = serde_json::from_slice(bytes).map_err(|_| rejected())?;
        if command.version != 1 || command.scope != "windows:sign-in" || command.sequence == 0 {
            return Err(rejected());
        }
        Ok(command)
    }
}
impl Drop for Command {
    fn drop(&mut self) {
        if let SignInEvent::Input(Input::TypeText { text }) = &mut self.input {
            text.zeroize();
        }
    }
}
/// One authenticated peer's input lane. It cannot be constructed from an
/// ordinary desktop grant. Transport must end its shared scope on peer loss.
pub struct SignInInput {
    scope: Arc<SignInScope>,
    state: Arc<Mutex<Tracked<WindowsSink>>>,
    cancel: Arc<AtomicBool>,
    watchdog: Option<JoinHandle<()>>,
}
impl SignInInput {
    pub fn start(scope: Arc<SignInScope>) -> Result<Self, HostError> {
        let result = Self::start_inner(scope.clone());
        if result.is_err() {
            scope.stop();
        }
        result
    }
    fn start_inner(scope: Arc<SignInScope>) -> Result<Self, HostError> {
        scope.authorize()?;
        let state = Arc::new(Mutex::new(Tracked::new(
            WindowsSink,
            scope.clone(),
            signin_scope::tick(),
        )?));
        let cancel = Arc::new(AtomicBool::new(false));
        let watcher_state = state.clone();
        let watcher_cancel = cancel.clone();
        let watcher_scope = scope.clone();
        let watchdog = thread::Builder::new()
            .name("signin-input-expiry".into())
            .spawn(move || loop {
                let Ok(mut state) = watcher_state.lock() else {
                    watcher_scope.stop();
                    return;
                };
                let now = signin_scope::tick();
                if watcher_cancel.load(Ordering::Acquire) {
                    state.end(now);
                }
                if state.poll(now) {
                    return;
                }
                drop(state);
                thread::sleep(Duration::from_millis(25));
            })?;
        Ok(Self {
            scope,
            state,
            cancel,
            watchdog: Some(watchdog),
        })
    }
    pub fn geometry(&self) -> Result<Display, HostError> {
        self.scope.authorize()?;
        let state = self.state.lock().map_err(|_| rejected())?;
        if state.sink.layout()? != state.layout {
            self.scope.stop();
            return Err(rejected());
        }
        Ok(state.layout.display())
    }
    pub fn receive(&mut self, bytes: Vec<u8>) -> Result<(), HostError> {
        let bytes = Zeroizing::new(bytes);
        let result = (|| {
            let command = Command::decode(&bytes)?;
            self.scope.authorize_binding(
                &command.lease_id,
                &command.instance_id,
                command.console_session_id,
            )?;
            let mut state = self.state.lock().map_err(|_| rejected())?;
            match &command.input {
                SignInEvent::Input(input) => {
                    state.process(command.sequence, input, signin_scope::tick())
                }
                SignInEvent::Attention(AttentionInput::SecureAttention {}) => {
                    // Shares the input lane's replay sequence. Release all owned
                    // keys/buttons before the service can request secure attention.
                    state.process(command.sequence, &Input::ReleaseAll, signin_scope::tick())?;
                    self.scope.request_attention(command.sequence)
                }
            }
        })();
        if result.is_err() {
            self.scope.stop();
            if let Ok(mut state) = self.state.lock() {
                state.end(signin_scope::tick());
            }
        }
        result
    }
    pub fn cleanup_confirmed(&self) -> bool {
        self.state
            .lock()
            .is_ok_and(|state| state.ended.is_some() && !state.held())
    }
}

impl Drop for SignInInput {
    fn drop(&mut self) {
        self.scope.stop();
        self.cancel.store(true, Ordering::Release);
        if let Some(watchdog) = self.watchdog.take() {
            unsafe {
                WaitForSingleObject(watchdog.as_raw_handle(), 3500);
            }
            if watchdog.is_finished() {
                let _ = watchdog.join();
            }
        }
        if self.state.try_lock().map_or(true, |state| state.held()) {
            eprintln!("Sign-in input cleanup could not be confirmed on its original desktop.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestGate {
        live: AtomicBool,
        cleanup: AtomicBool,
    }
    impl Gate for TestGate {
        fn live(&self) -> bool {
            self.live.load(Ordering::Acquire)
        }
        fn cleanup(&self) -> bool {
            self.cleanup.load(Ordering::Acquire)
        }
        fn stop(&self) {
            self.live.store(false, Ordering::Release);
        }
    }
    struct TestSink {
        events: Arc<Mutex<Vec<Event>>>,
        layout: Layout,
        fail_up: Arc<AtomicBool>,
        expire_after_down: Option<Arc<TestGate>>,
    }
    impl Sink for TestSink {
        fn layout(&self) -> Result<Layout, HostError> {
            Ok(self.layout)
        }
        fn send(&mut self, event: Event) -> Result<(), HostError> {
            self.events.lock().unwrap().push(event);
            if matches!(
                event,
                Event::Scan(_, _, true) | Event::Unicode(_, true) | Event::Button(_, true)
            ) {
                if let Some(gate) = &self.expire_after_down {
                    gate.live.store(false, Ordering::Release);
                }
            }
            if self.fail_up.load(Ordering::Acquire)
                && matches!(
                    event,
                    Event::Scan(_, _, false) | Event::Unicode(_, false) | Event::Button(_, false)
                )
            {
                return Err(rejected());
            }
            Ok(())
        }
    }
    fn layout() -> Layout {
        Layout {
            device: [0; 32],
            monitor: 1,
            left: 0,
            top: 0,
            width: 1920,
            height: 1080,
            virtual_left: -1920,
            virtual_top: -1080,
            virtual_width: 3840,
            virtual_height: 2160,
            rotation: 0,
        }
    }
    fn fixture() -> (Tracked<TestSink>, Arc<TestGate>) {
        let gate = Arc::new(TestGate {
            live: AtomicBool::new(true),
            cleanup: AtomicBool::new(true),
        });
        let sink = TestSink {
            events: Arc::new(Mutex::new(Vec::new())),
            layout: layout(),
            fail_up: Arc::new(AtomicBool::new(false)),
            expire_after_down: None,
        };
        (Tracked::new(sink, gate.clone(), 1000).unwrap(), gate)
    }
    /// Something physically held on the sign-in desktop: a pressed mouse button (keys are always complete taps).
    fn down() -> Input {
        Input::Button {
            button: MouseButton::Left,
            down: true,
        }
    }
    #[test]
    fn enter_is_a_complete_tap_so_nothing_is_left_held_when_signing_in_leaves_the_desktop() {
        let (mut state, _gate) = fixture();
        let enter = |down| Input::Key {
            scan_code: 0x1c,
            extended: false,
            down,
        };
        state.process(1, &enter(true), 1000).unwrap();
        assert!(!state.held());
        assert!(
            state.sink.events.lock().unwrap().as_slice()
                == [
                    Event::Scan(0x1c, false, true),
                    Event::Scan(0x1c, false, false)
                ]
        );
        // The viewer's own key-up arrives later and changes nothing.
        state.process(2, &enter(false), 1001).unwrap();
        assert_eq!(state.sink.events.lock().unwrap().len(), 2);
        // Shift is remembered, not pressed; a key under it is one step with Shift around it, and nothing stays down.
        let shift = |down| Input::Key {
            scan_code: 0x2a,
            extended: false,
            down,
        };
        let g = |down| Input::Key {
            scan_code: 0x22,
            extended: false,
            down,
        };
        state.process(3, &shift(true), 1002).unwrap();
        assert_eq!(state.sink.events.lock().unwrap().len(), 2);
        state.process(4, &g(true), 1003).unwrap();
        assert!(!state.held());
        assert!(
            state.sink.events.lock().unwrap()[2..]
                == [
                    Event::Scan(0x2a, false, true),
                    Event::Scan(0x22, false, true),
                    Event::Scan(0x22, false, false),
                    Event::Scan(0x2a, false, false)
                ]
        );
        state.process(5, &g(false), 1004).unwrap();
        state.process(6, &shift(false), 1005).unwrap();
        assert_eq!(state.sink.events.lock().unwrap().len(), 6);
    }

    #[test]
    fn expiry_during_a_down_event_owns_and_releases_the_partial_operation() {
        let (mut state, gate) = fixture();
        state.sink.expire_after_down = Some(gate.clone());
        assert!(state.process(1, &down(), 1000).is_err());
        assert!(!state.held() && !gate.live());
        assert!(
            state.sink.events.lock().unwrap().as_slice()
                == [
                    Event::Button(MouseButton::Left, true),
                    Event::Button(MouseButton::Left, false)
                ]
        );
    }
    #[test]
    fn message_namespace_unknown_capabilities_and_sequence_are_strict() {
        let message = serde_json::json!({"version":1,"scope":"windows:sign-in","leaseId":uuid::Uuid::new_v4().to_string(),"instanceId":uuid::Uuid::new_v4().to_string(),"consoleSessionId":2,"sequence":1,"input":{"type":"keep_alive"}});
        assert!(Command::decode(&serde_json::to_vec(&message).unwrap()).is_ok());
        for (field, value) in [
            ("scope", serde_json::json!("desktop:control")),
            ("version", serde_json::json!(2)),
            ("sequence", serde_json::json!(0)),
            ("files", serde_json::json!(true)),
        ] {
            let mut invalid = message.clone();
            invalid[field] = value;
            assert!(Command::decode(&serde_json::to_vec(&invalid).unwrap()).is_err());
        }
        assert!(Command::decode(&[b' '; MAX_MESSAGE + 1]).is_err());
        let mut attention = message;
        attention["input"] = serde_json::json!({"type":"secure_attention"});
        assert!(matches!(
            Command::decode(&serde_json::to_vec(&attention).unwrap())
                .unwrap()
                .input,
            SignInEvent::Attention(_)
        ));
        assert!(serde_json::from_value::<Input>(attention["input"].clone()).is_err());
        attention["input"]["command"] = serde_json::json!("anything");
        assert!(Command::decode(&serde_json::to_vec(&attention).unwrap()).is_err());
    }
    #[test]
    fn idle_cleanup_releases_remote_state_without_restoring_or_extending_authority() {
        let (mut state, gate) = fixture();
        state.process(1, &down(), 1000).unwrap();
        state
            .process(
                2,
                &Input::Button {
                    button: MouseButton::Right,
                    down: true,
                },
                1001,
            )
            .unwrap();
        assert!(!state.poll(1001 + IDLE));
        assert!(!state.held());
        assert!(state.ended.is_none() && gate.live());
        let events = state.sink.events.lock().unwrap();
        assert!(
            events.as_slice()
                == [
                    Event::Button(MouseButton::Left, true),
                    Event::Button(MouseButton::Right, true),
                    Event::Button(MouseButton::Left, false),
                    Event::Button(MouseButton::Right, false)
                ]
        );
        drop(events);
        state.process(3, &down(), 1002 + IDLE).unwrap();
        gate.live.store(false, Ordering::Release);
        assert!(state.poll(1003 + IDLE));
        assert!(!state.held());
        gate.live.store(true, Ordering::Release);
        assert!(state.process(4, &down(), 1004 + IDLE).is_err());
    }
    #[test]
    fn ended_scope_never_sends_keyups_to_another_desktop_and_preserves_failed_cleanup() {
        let (mut state, gate) = fixture();
        state.process(1, &down(), 1000).unwrap();
        gate.live.store(false, Ordering::Release);
        gate.cleanup.store(false, Ordering::Release);
        assert!(!state.poll(2000));
        assert!(state.poll(2000 + CLEANUP));
        assert!(state.held());
        assert!(
            state.sink.events.lock().unwrap().as_slice()
                == [Event::Button(MouseButton::Left, true)]
        );
        gate.cleanup.store(true, Ordering::Release);
        state.sink.fail_up.store(true, Ordering::Release);
        assert!(state.poll(2001 + CLEANUP));
        assert!(state.held());
        state.sink.fail_up.store(false, Ordering::Release);
        assert!(state.poll(2002 + CLEANUP));
        assert!(!state.held());
        assert!(state.sink.events.lock().unwrap()[1..]
            .iter()
            .all(|event| *event == Event::Button(MouseButton::Left, false)));
    }
    #[test]
    fn unicode_failure_and_replayed_sequence_end_the_scope_and_release_only_held_state() {
        let (mut state, gate) = fixture();
        state.sink.fail_up.store(true, Ordering::Release);
        assert!(state
            .process(1, &Input::TypeText { text: "A".into() }, 1000)
            .is_err());
        assert!(!gate.live() && state.unicode.contains(&65));
        state.sink.fail_up.store(false, Ordering::Release);
        assert!(state.poll(1001));
        assert!(!state.held());
        assert!(state.sink.events.lock().unwrap()[1..]
            .iter()
            .all(|event| *event == Event::Unicode(65, false)));
        let (mut replay, gate) = fixture();
        replay.process(1, &down(), 1000).unwrap();
        assert!(replay.process(1, &Input::KeepAlive, 1001).is_err());
        assert!(!gate.live() && !replay.held());
    }
    #[test]
    fn clipboard_layout_change_and_silent_input_lane_cannot_keep_control_alive() {
        let (mut state, gate) = fixture();
        assert!(state.process(1, &Input::ClipboardRead, 1000).is_err());
        assert!(!gate.live() && state.sink.events.lock().unwrap().is_empty());
        let (mut changed, gate) = fixture();
        changed.process(1, &down(), 1000).unwrap();
        changed.sink.layout.rotation = 2;
        assert!(changed.process(2, &Input::KeepAlive, 1001).is_err());
        assert!(!gate.live() && !changed.held());
        let (mut silent, gate) = fixture();
        assert!(silent.poll(1000 + SILENCE));
        assert!(!gate.live());
    }
    #[test]
    fn absolute_pointer_bins_cover_physical_pixels_and_negative_virtual_origins() {
        for size in [1, 2, 3, 1920, 3840, 65536] {
            for pixel in 0..size {
                let absolute = axis(pixel as i64, size).unwrap();
                assert!((0..=65535).contains(&absolute));
                assert_eq!(absolute as i64 * size as i64 / 65536, pixel as i64);
            }
        }
        let layout = layout();
        let (x, y) = layout.pointer(0, 0).unwrap();
        assert_eq!(x as i64 * layout.virtual_width as i64 / 65536, 1920);
        assert_eq!(y as i64 * layout.virtual_height as i64 / 65536, 1080);
        assert!(layout.pointer(1920, 0).is_err());
        assert!(axis(-1, 1920).is_err() && axis(1, 0).is_err() && axis(0, 65537).is_err());
    }
    #[test]
    fn lease_without_peer_cannot_create_an_os_input_adapter() {
        let scope = SignInScope::new(
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
            2,
            signin_scope::tick() + 10_000 * T,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!(SignInInput::start(scope.clone()).is_err());
        assert!(scope.expired());
    }
}
