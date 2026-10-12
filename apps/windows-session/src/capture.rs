use beacon_remote_core::{ControlError, Display, ScreenCapture, Snapshot};
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
};
use windows_sys::Win32::{
    Graphics::Gdi::{GetMonitorInfoW, MONITORINFO},
    System::{
        StationsAndDesktops::{GetThreadDesktop, GetUserObjectInformationW, UOI_IO},
        Threading::GetCurrentThreadId,
    },
    UI::{
        HiDpi::{
            GetDpiForMonitor, SetProcessDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
        },
        WindowsAndMessaging::{
            MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONINFORMATION, MB_SETFOREGROUND, MB_YESNO,
        },
    },
};

type Error = Box<dyn std::error::Error + Send + Sync>;

// UOI_IO is false when this thread's desktop no longer receives local input,
// including lock/secure-desktop switches. Never switch desktops or request
// additional rights. Any query failure denies capture and cached snapshots.
pub(crate) fn desktop_receives_input() -> bool {
    let desktop = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
    if desktop.is_null() {
        return false;
    }
    let mut receives_input: i32 = 0;
    unsafe {
        GetUserObjectInformationW(
            desktop,
            UOI_IO,
            std::ptr::from_mut(&mut receives_input).cast(),
            std::mem::size_of_val(&receives_input) as u32,
            std::ptr::null_mut(),
        ) != 0
            && receives_input != 0
    }
    // GetThreadDesktop returns a borrowed handle; it must not be closed.
}

fn displays() -> Result<Vec<Display>, Error> {
    Monitor::enumerate()?
        .iter()
        .map(|monitor| {
            let handle = monitor.as_raw_hmonitor();
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            let mut dpi_x = 0;
            let mut dpi_y = 0;
            // The process is per-monitor DPI aware before any window/capture is created.
            if unsafe { GetMonitorInfoW(handle, &mut info) } == 0
                || unsafe { GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) }
                    < 0
            {
                return Err(io::Error::last_os_error().into());
            }
            Ok(Display {
                id: monitor.device_name()?,
                width: monitor.width()?,
                height: monitor.height()?,
                origin_x: info.rcMonitor.left,
                origin_y: info.rcMonitor.top,
                scale: f64::from(dpi_x) / 96.0,
            })
        })
        .collect()
}

pub fn dpi_awareness() -> Result<(), Error> {
    if unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) } == 0 {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}

pub fn list_displays() -> Result<(), Error> {
    dpi_awareness()?;
    for display in displays()? {
        println!(
            "{}: {}x{} physical pixels, origin ({}, {}), DPI scale {:.2}",
            display.id,
            display.width,
            display.height,
            display.origin_x,
            display.origin_y,
            display.scale
        );
    }
    Ok(())
}

#[derive(Default)]
struct FrameState {
    latest: Option<Snapshot>,
    frames: u64,
    copy_time: Duration,
    first_frame_latency: Option<Duration>,
}

#[derive(Clone)]
struct CaptureFlags {
    state: Arc<Mutex<FrameState>>,
    active: Arc<AtomicBool>,
    session_active: Arc<AtomicBool>,
    display_id: String,
    started: Instant,
}

struct Handler {
    flags: CaptureFlags,
}

impl GraphicsCaptureApiHandler for Handler {
    type Flags = CaptureFlags;
    type Error = Error;
    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { flags: ctx.flags })
    }
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if !self.flags.active.load(Ordering::Acquire)
            || !self.flags.session_active.load(Ordering::Acquire)
            || !desktop_receives_input()
        {
            self.flags.active.store(false, Ordering::Release);
            self.flags
                .state
                .lock()
                .map_err(|_| "Capture state unavailable")?
                .latest = None;
            control.stop();
            return Ok(());
        }
        let width = frame.width();
        let height = frame.height();
        let bytes = u64::from(width) * u64::from(height) * 4;
        if bytes == 0 || bytes > 64 * 1024 * 1024 {
            return Err("Display exceeds the 64 MiB frame budget".into());
        }
        let readback = Instant::now();
        let buffer = frame.buffer()?;
        let mut padding = Vec::new();
        let pixels = buffer.as_nopadding_buffer(&mut padding);
        if pixels.len() as u64 != bytes {
            return Err("Invalid BGRA frame length".into());
        }
        let mut state = self
            .flags
            .state
            .lock()
            .map_err(|_| "Capture state unavailable")?;
        if !self.flags.active.load(Ordering::Acquire)
            || !self.flags.session_active.load(Ordering::Acquire)
            || !desktop_receives_input()
        {
            self.flags.active.store(false, Ordering::Release);
            state.latest = None;
            control.stop();
            return Ok(());
        }
        // Retain one owned frame, never an unbounded queue of screen contents.
        let latest = state.latest.get_or_insert_with(|| Snapshot {
            display_id: self.flags.display_id.clone(),
            width,
            height,
            bgra: Vec::new(),
        });
        latest.width = width;
        latest.height = height;
        latest.bgra.clear();
        latest.bgra.extend_from_slice(pixels);
        state.frames += 1;
        state.copy_time += readback.elapsed();
        state
            .first_frame_latency
            .get_or_insert_with(|| self.flags.started.elapsed());
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.flags.active.store(false, Ordering::Release);
        self.flags
            .state
            .lock()
            .map_err(|_| "Capture state unavailable")?
            .latest = None;
        Ok(())
    }
}

struct CaptureSource {
    flags: CaptureFlags,
}

/// Owned attended capture. Caller must first verify authorization and consent.
pub struct DesktopCapture {
    source: CaptureSource,
    control: Option<CaptureControl<Handler, Error>>,
}
impl DesktopCapture {
    #[cfg(test)]
    pub fn start(active: Arc<AtomicBool>) -> Result<Self, Error> {
        Self::start_with_session(active.clone(), active)
    }
    pub fn start_with_session(
        active: Arc<AtomicBool>,
        session_active: Arc<AtomicBool>,
    ) -> Result<Self, Error> {
        if !active.load(Ordering::Acquire)
            || !session_active.load(Ordering::Acquire)
            || !desktop_receives_input()
        {
            active.store(false, Ordering::Release);
            return Err("The local desktop is unavailable for attended sharing".into());
        }
        let monitor = Monitor::primary()?;
        let flags = CaptureFlags {
            state: Arc::new(Mutex::new(FrameState::default())),
            active,
            session_active,
            display_id: monitor.device_name()?,
            started: Instant::now(),
        };
        let settings = Settings::new(
            monitor,
            CursorCaptureSettings::WithCursor,
            DrawBorderSettings::WithBorder,
            SecondaryWindowSettings::Exclude,
            MinimumUpdateIntervalSettings::Custom(Duration::from_millis(33)),
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            flags.clone(),
        );
        let control = Handler::start_free_threaded(settings)?;
        Ok(Self {
            source: CaptureSource { flags },
            control: Some(control),
        })
    }

    pub fn snapshot(&mut self) -> Result<Option<Snapshot>, Error> {
        if self
            .control
            .as_ref()
            .is_none_or(|control| control.is_finished())
        {
            return Err("Desktop capture ended".into());
        }
        let id = self.source.flags.display_id.clone();
        match self.source.capture_snapshot(&id) {
            Ok(snapshot) => Ok(Some(snapshot)),
            Err(ControlError::PlatformUnavailable)
                if self.source.flags.started.elapsed() < Duration::from_secs(3) =>
            {
                Ok(None)
            }
            _ => Err("Desktop frame unavailable".into()),
        }
    }
}
impl Drop for DesktopCapture {
    fn drop(&mut self) {
        self.source.flags.active.store(false, Ordering::Release);
        if let Some(control) = self.control.take() {
            let _ = control.stop();
        }
        if let Ok(mut state) = self.source.flags.state.lock() {
            state.latest = None;
        }
    }
}
impl ScreenCapture for CaptureSource {
    fn get_displays(&self) -> Result<Vec<Display>, ControlError> {
        displays().map_err(|_| ControlError::PlatformUnavailable)
    }
    fn capture_snapshot(&mut self, display_id: &str) -> Result<Snapshot, ControlError> {
        if !desktop_receives_input() {
            self.flags.active.store(false, Ordering::Release);
            if let Ok(mut state) = self.flags.state.lock() {
                state.latest = None;
            }
            return Err(ControlError::PlatformUnavailable);
        }
        if !self.flags.active.load(Ordering::Acquire)
            || !self.flags.session_active.load(Ordering::Acquire)
        {
            if let Ok(mut state) = self.flags.state.lock() {
                state.latest = None;
            }
            return Err(ControlError::NoLease);
        }
        if display_id != self.flags.display_id {
            return Err(ControlError::PlatformUnavailable);
        }
        let state = self
            .flags
            .state
            .lock()
            .map_err(|_| ControlError::PlatformUnavailable)?;
        let frame = state
            .latest
            .as_ref()
            .ok_or(ControlError::PlatformUnavailable)?;
        Ok(Snapshot {
            display_id: frame.display_id.clone(),
            width: frame.width,
            height: frame.height,
            bgra: frame.bgra.clone(),
        })
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

pub fn benchmark() -> Result<(), Error> {
    if !desktop_receives_input() {
        return Err("Local input desktop unavailable; capture denied".into());
    }
    dpi_awareness()?;
    let monitor = Monitor::primary()?;
    let display_id = monitor.device_name()?;
    let message = wide("Beacon Remote will capture your PRIMARY DISPLAY locally for ten seconds.\n\nA Windows capture border remains visible. Frames stay in memory: no recording, upload, or remote control.\n\nPress Ctrl+C in the console to stop early. Choose Yes to start or No to cancel.");
    let title = wide("Beacon Remote — local capture consent");
    if unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_DEFBUTTON2,
        )
    } != IDYES
    {
        println!("Capture canceled; no frames captured.");
        return Ok(());
    }
    if !desktop_receives_input() {
        return Err("Local input desktop unavailable; capture denied".into());
    }
    let flags = CaptureFlags {
        state: Arc::new(Mutex::new(FrameState::default())),
        active: Arc::new(AtomicBool::new(true)),
        session_active: Arc::new(AtomicBool::new(true)),
        display_id,
        started: Instant::now(),
    };
    let active = flags.active.clone();
    ctrlc::set_handler(move || {
        active.store(false, Ordering::Release);
    })?;
    let settings = Settings::new(
        monitor,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::WithBorder,
        SecondaryWindowSettings::Exclude,
        MinimumUpdateIntervalSettings::Custom(Duration::from_millis(33)),
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags.clone(),
    );
    let control = Handler::start_free_threaded(settings)?;
    let mut source = CaptureSource {
        flags: flags.clone(),
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    println!("CAPTURE ACTIVE: primary display, ten-second local benchmark. Ctrl+C stops capture.");
    while Instant::now() < deadline
        && flags.active.load(Ordering::Acquire)
        && !control.is_finished()
        && desktop_receives_input()
    {
        thread::sleep(Duration::from_millis(50));
    }
    let snapshot = source.capture_snapshot(&flags.display_id);
    flags.active.store(false, Ordering::Release); // Deny snapshot access before joining capture.
    let stopped = control.stop();
    let mut state = flags
        .state
        .lock()
        .map_err(|_| "Capture state unavailable")?;
    state.latest = None;
    stopped?;
    if let Ok(snapshot) = snapshot {
        println!(
            "Real snapshot capability: {}x{}, {} BGRA bytes (not saved).",
            snapshot.width,
            snapshot.height,
            snapshot.bgra.len()
        );
    }
    if state.frames == 0 {
        return Err("No real frames captured; no performance result available".into());
    }
    println!("Capture stopped. Frames: {}; update FPS: {:.2}; first-frame latency: {:.2} ms; mean GPU readback/copy: {:.2} ms.",
        state.frames, state.frames as f64 / flags.started.elapsed().as_secs_f64(),
        state.first_frame_latency.unwrap_or_default().as_secs_f64() * 1000.0,
        state.copy_time.as_secs_f64() * 1000.0 / state.frames as f64);
    println!("FPS reflects actual compositor updates, not a constant-video cadence. CPU/memory require a separate process sample.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_stop_denies_cached_pixels_even_when_transport_token_is_live() {
        let state = Arc::new(Mutex::new(FrameState {
            latest: Some(Snapshot {
                display_id: "test".into(),
                width: 1,
                height: 1,
                bgra: vec![0; 4],
            }),
            ..Default::default()
        }));
        let mut source = CaptureSource {
            flags: CaptureFlags {
                state: state.clone(),
                active: Arc::new(AtomicBool::new(true)),
                session_active: Arc::new(AtomicBool::new(false)),
                display_id: "test".into(),
                started: Instant::now(),
            },
        };
        assert!(source.capture_snapshot("test").is_err());
        assert!(state.lock().unwrap().latest.is_none());
    }
    use windows_sys::Win32::System::StationsAndDesktops::{
        CloseDesktop, CreateDesktopW, SetThreadDesktop, DESKTOP_CREATEWINDOW, DESKTOP_READOBJECTS,
    };

    #[test]
    fn noninput_desktop_denies_consent_capture_and_cached_snapshot() {
        // The test creates a temporary hidden desktop on a fresh thread. It
        // never switches the visible desktop, approves consent, or captures.
        thread::spawn(|| unsafe {
            let original = GetThreadDesktop(GetCurrentThreadId());
            assert!(!original.is_null());
            let name = wide(&format!("BeaconRemoteGuardTest-{}", std::process::id()));
            let desktop = CreateDesktopW(
                name.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                DESKTOP_CREATEWINDOW | DESKTOP_READOBJECTS,
                std::ptr::null(),
            );
            assert!(!desktop.is_null(), "{}", io::Error::last_os_error());
            let result = std::panic::catch_unwind(|| {
                assert_ne!(SetThreadDesktop(desktop), 0);
                assert!(!desktop_receives_input());
                assert!(!crate::consent::request(
                    "guard-test@example.invalid",
                    Arc::new(AtomicBool::new(true)),
                    Instant::now() + Duration::from_secs(1),
                )
                .unwrap());

                let active = Arc::new(AtomicBool::new(true));
                assert!(crate::indicator::Indicator::start(
                    active.clone(),
                    Arc::new(AtomicBool::new(false)),
                    true,
                    "guard-test@example.invalid".into(),
                    Instant::now() + Duration::from_secs(1),
                )
                .is_err());
                assert!(!active.load(Ordering::Acquire));

                let active = Arc::new(AtomicBool::new(true));
                assert!(DesktopCapture::start(active.clone()).is_err());
                assert!(!active.load(Ordering::Acquire));

                let state = Arc::new(Mutex::new(FrameState {
                    latest: Some(Snapshot {
                        display_id: "test".into(),
                        width: 1,
                        height: 1,
                        bgra: vec![0; 4],
                    }),
                    ..Default::default()
                }));
                active.store(true, Ordering::Release);
                let mut source = CaptureSource {
                    flags: CaptureFlags {
                        state: state.clone(),
                        active: active.clone(),
                        session_active: active.clone(),
                        display_id: "test".into(),
                        started: Instant::now(),
                    },
                };
                assert!(source.capture_snapshot("test").is_err());
                assert!(!active.load(Ordering::Acquire));
                assert!(state.lock().unwrap().latest.is_none());
            });
            assert_ne!(SetThreadDesktop(original), 0);
            assert_ne!(CloseDesktop(desktop), 0);
            if let Err(panic) = result {
                std::panic::resume_unwind(panic);
            }
        })
        .join()
        .unwrap();
    }
}
