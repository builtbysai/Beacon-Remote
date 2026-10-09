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
    capture::{Context, GraphicsCaptureApiHandler},
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
    UI::{
        HiDpi::{
            GetDpiForMonitor, SetProcessDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
        },
        WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONINFORMATION, MB_SETFOREGROUND, MB_YESNO},
    },
};

type Error = Box<dyn std::error::Error + Send + Sync>;

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

fn dpi_awareness() -> Result<(), Error> {
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
        if !self.flags.active.load(Ordering::Acquire) {
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
        if !self.flags.active.load(Ordering::Acquire) {
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
impl ScreenCapture for CaptureSource {
    fn get_displays(&self) -> Result<Vec<Display>, ControlError> {
        displays().map_err(|_| ControlError::PlatformUnavailable)
    }
    fn capture_snapshot(&mut self, display_id: &str) -> Result<Snapshot, ControlError> {
        if !self.flags.active.load(Ordering::Acquire) {
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
            MB_YESNO | MB_ICONINFORMATION | MB_SETFOREGROUND,
        )
    } != IDYES
    {
        println!("Capture canceled; no frames captured.");
        return Ok(());
    }
    let flags = CaptureFlags {
        state: Arc::new(Mutex::new(FrameState::default())),
        active: Arc::new(AtomicBool::new(true)),
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
