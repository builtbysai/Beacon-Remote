//! The helper's side of ADR 0059. The helper draws nothing: it tells the host window what needs a decision and what
//! is being shared, over its stdout (one JSON line each, [`crate::ui_protocol`]), and acts only on what comes back on
//! its stdin. Everything the old consent and Stop windows enforced is enforced here, in the helper:
//!
//! * nothing is approved without an `answer` for the one pending prompt id, `allow` true, before the deadline, while
//!   the request is still pending and the input desktop is the captured one;
//! * decline is the default: no host, an expired deadline, a withdrawn request, a forged or duplicate answer, a
//!   malformed line or a closed pipe all decline or end the session;
//! * a liveness lease: if the host has not said `alive` for [`LEASE_SECONDS`] the session ends, so a hung host window
//!   cannot leave a screen shared with nobody able to press Stop.
use beacon_remote_session::ui_protocol::{
    self as wire, Prompt, PromptKind, SessionState, ToHelper, ToHost, LEASE_SECONDS, MAX_LINE,
};
use std::{
    io::{BufRead, Read, Write},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

type Error = Box<dyn std::error::Error + Send + Sync>;

/// What the person chose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Declined,
    View,
    Control,
}

/// What the person chose: the access level and the optional extras.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Access {
    pub decision: Decision,
    pub files: bool,
    pub recording: bool,
    /// The helper may hear what this computer is playing (ADR 0044). Never includes a microphone.
    pub audio: bool,
}
impl Access {
    const DECLINED: Self = Self {
        decision: Decision::Declined,
        files: false,
        recording: false,
        audio: false,
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LivePermission {
    Control,
    Files,
    Recording,
    Drive,
    Print,
}
impl LivePermission {
    fn detail(self) -> &'static str {
        match self {
            Self::Control => "Allow mouse and keyboard for this connection",
            Self::Files => "Allow sending and receiving files for this connection",
            Self::Recording => "Allow the viewer to record the shared stream",
            Self::Drive => "Allow the viewer to use the shared folder for this connection",
            Self::Print => "Allow the viewer to print on the selected printers for this connection",
        }
    }
}

/// The first request: what was asked for.
#[derive(Clone)]
pub struct FirstRequest {
    pub control: bool,
    pub unlimited: bool,
    pub display: String,
}

struct Answer {
    allow: bool,
    control: bool,
    files: bool,
    recording: bool,
    audio: bool,
}
struct Pending {
    id: u32,
    answer: Option<Answer>,
}

/// What the session shows, shared with the bridge's own threads.
struct Shared {
    active: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    control: Arc<AtomicBool>,
    extras: Arc<AtomicU8>,
    desktop: bool,
    controller: String,
    session: String,
    audio: AtomicBool,
    deadline: Mutex<Option<Instant>>,
    /// The first approval is done (or not needed): the host may show the sharing card.
    shown: AtomicBool,
}
impl Shared {
    fn deadline(&self) -> Option<Instant> {
        self.deadline.lock().ok().and_then(|end| *end)
    }
}

/// The conversation with the host window.
pub struct Link {
    out: Mutex<Option<Box<dyn Write + Send>>>,
    next_id: AtomicU32,
    pending: Mutex<Option<Pending>>,
    changed: Condvar,
    last_alive: Mutex<Instant>,
    /// Stops the whole helper when cleared.
    active: Arc<AtomicBool>,
    session: Mutex<Option<Arc<Shared>>>,
    /// Whether the input-desktop check applies (always, except in tests).
    check_desktop: bool,
}

static LINK: OnceLock<Arc<Link>> = OnceLock::new();

impl Link {
    fn new(
        out: Option<Box<dyn Write + Send>>,
        active: Arc<AtomicBool>,
        check_desktop: bool,
    ) -> Self {
        Self {
            out: Mutex::new(out),
            next_id: AtomicU32::new(1),
            pending: Mutex::new(None),
            changed: Condvar::new(),
            last_alive: Mutex::new(Instant::now()),
            active,
            session: Mutex::new(None),
            check_desktop,
        }
    }
    fn hosted(&self) -> bool {
        self.out.lock().map(|out| out.is_some()).unwrap_or(false)
    }
    fn send(&self, message: &ToHost) {
        if let Ok(mut out) = self.out.lock() {
            if let Some(writer) = out.as_mut() {
                let _ = writer
                    .write_all(wire::encode(message).as_bytes())
                    .and_then(|()| writer.flush());
            }
        }
    }
    fn desktop_ok(&self) -> bool {
        !self.check_desktop || crate::capture::desktop_receives_input()
    }

    /// Fail closed: the host is gone, or said something this helper does not accept.
    fn stop(&self) {
        self.active.store(false, Ordering::Release);
        self.changed.notify_all();
    }

    /// True once the host has been silent for longer than the lease. Ends the helper.
    fn check_lease(&self, now: Instant) -> bool {
        let silent = self
            .last_alive
            .lock()
            .map(|seen| now.saturating_duration_since(*seen))
            .unwrap_or(Duration::MAX);
        let expired = silent > Duration::from_secs(LEASE_SECONDS);
        if expired {
            self.stop();
        }
        expired
    }

    /// One line from the host.
    fn handle(&self, line: &str) {
        let Ok(message) = wire::parse_to_helper(line) else {
            self.stop();
            return;
        };
        match message {
            ToHelper::Alive => {
                if let Ok(mut seen) = self.last_alive.lock() {
                    *seen = Instant::now();
                }
            }
            ToHelper::Stop => self.stop(),
            ToHelper::Pause { on } => crate::pause::set(on),
            ToHelper::Mute { on } => crate::audio::set_muted(on),
            ToHelper::RevokeExtras => {
                if let Some(shared) = self.session.lock().ok().and_then(|s| s.clone()) {
                    crate::files_transport::Permissions::default().publish(&shared.extras);
                }
            }
            ToHelper::SendFile { path } => {
                let shared = self.session.lock().ok().and_then(|s| s.clone());
                let allowed = shared.is_some_and(|shared| {
                    shared.active.load(Ordering::Acquire)
                        && shared.connected.load(Ordering::Acquire)
                        && crate::files_transport::Permissions::read(&shared.extras).files
                        && !crate::pause::is_paused()
                });
                if allowed {
                    crate::files::request_send(path.into());
                }
            }
            ToHelper::Answer {
                id,
                allow,
                control,
                files,
                recording,
                audio,
            } => {
                if let Ok(mut pending) = self.pending.lock() {
                    // Only the one pending prompt, and only its first answer, counts.
                    if let Some(prompt) = pending
                        .as_mut()
                        .filter(|p| p.id == id && p.answer.is_none())
                    {
                        prompt.answer = Some(Answer {
                            allow,
                            control,
                            files,
                            recording,
                            audio,
                        });
                        self.changed.notify_all();
                    }
                }
            }
        }
    }

    /// Reads the host's lines until EOF or a line this helper refuses; either ends the session.
    fn read_lines(&self, mut reader: impl BufRead) {
        loop {
            let mut line = String::new();
            let read = Read::take(&mut reader, MAX_LINE as u64 + 2).read_line(&mut line);
            if !matches!(read, Ok(count) if count > 0) || !line.ends_with('\n') {
                self.stop();
                return;
            }
            self.handle(&line);
            if !self.active.load(Ordering::Acquire) {
                return;
            }
        }
    }

    /// Asks the host's person one question. Anything but an explicit allow, in time, while still pending, is `None`.
    fn ask(&self, mut prompt: Prompt, pending: &AtomicBool, deadline: Instant) -> Option<Answer> {
        if !self.hosted() || !self.active.load(Ordering::Acquire) || !self.desktop_ok() {
            return None;
        }
        let id = {
            let mut slot = self.pending.lock().ok()?;
            if slot.is_some() {
                return None;
            }
            let id = self.next_id.fetch_add(1, Ordering::AcqRel);
            *slot = Some(Pending { id, answer: None });
            id
        };
        prompt.id = id;
        prompt.deadline_ms = deadline
            .saturating_duration_since(Instant::now())
            .as_millis()
            .min(120_000) as u64;
        self.send(&ToHost::Prompt(prompt));
        let mut slot = self.pending.lock().ok()?;
        let answer = loop {
            if let Some(answer) = slot.as_mut().and_then(|p| p.answer.take()) {
                break Some(answer);
            }
            if !pending.load(Ordering::Acquire)
                || !self.active.load(Ordering::Acquire)
                || Instant::now() >= deadline
                || !self.desktop_ok()
            {
                break None;
            }
            slot = self
                .changed
                .wait_timeout(slot, Duration::from_millis(25))
                .ok()?
                .0;
        };
        *slot = None;
        drop(slot);
        let answer = answer.filter(|answer| {
            answer.allow
                && pending.load(Ordering::Acquire)
                && self.active.load(Ordering::Acquire)
                && Instant::now() < deadline
                && self.desktop_ok()
        });
        if answer.is_none() {
            self.send(&ToHost::Withdraw { id });
        }
        answer
    }

    fn snapshot(&self, shared: &Shared) -> SessionState {
        let extras = crate::files_transport::Permissions::read(&shared.extras);
        SessionState {
            controller: shared.controller.clone(),
            session: shared.session.clone(),
            desktop: shared.desktop,
            connected: shared.connected.load(Ordering::Acquire),
            control: shared.control.load(Ordering::Acquire),
            files: extras.files,
            recording: extras.recording,
            audio: shared.audio.load(Ordering::Acquire),
            paused: crate::pause::is_paused(),
            muted: crate::audio::muted(),
            recording_active: crate::files::recording(),
            note: wire::clean(&crate::files::status(), 160),
            remaining_ms: shared
                .deadline()
                .map(|end| end.saturating_duration_since(Instant::now()).as_millis() as u64),
        }
    }
}

/// Connects this helper to the host: stdout becomes the protocol pipe (ordinary prints move to stderr so nothing else
/// can reach it), stdin's remaining lines are the host's messages, and a watchdog enforces the liveness lease.
pub fn connect_host(
    reader: impl BufRead + Send + 'static,
    active: Arc<AtomicBool>,
) -> Result<(), Error> {
    let out = take_stdout()?;
    let link = Arc::new(Link::new(Some(Box::new(out)), active, true));
    LINK.set(link.clone())
        .map_err(|_| "Host link already set")?;
    let lines = link.clone();
    thread::spawn(move || lines.read_lines(reader));
    let watchdog = link;
    thread::spawn(move || {
        while watchdog.active.load(Ordering::Acquire) {
            if watchdog.check_lease(Instant::now()) {
                eprintln!("The host window stopped answering; ending the session.");
                return;
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
    Ok(())
}

/// The standalone path has no host window: requests decline and there is no Stop control to share behind.
pub fn connect_none(active: Arc<AtomicBool>) {
    let _ = LINK.set(Arc::new(Link::new(None, active, true)));
}

fn link() -> Option<Arc<Link>> {
    LINK.get().cloned()
}

#[cfg(windows)]
fn take_stdout() -> Result<std::fs::File, Error> {
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::Foundation::{DuplicateHandle, DUPLICATE_SAME_ACCESS};
    use windows_sys::Win32::System::Console::{
        GetStdHandle, SetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let out = GetStdHandle(STD_OUTPUT_HANDLE);
        if out.is_null() || out as isize == -1 {
            return Err("No host pipe on stdout".into());
        }
        let mut own = std::ptr::null_mut();
        if DuplicateHandle(
            GetCurrentProcess(),
            out,
            GetCurrentProcess(),
            &mut own,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        ) == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        // From here `println!` goes where stderr goes.
        SetStdHandle(STD_OUTPUT_HANDLE, GetStdHandle(STD_ERROR_HANDLE));
        Ok(std::fs::File::from_raw_handle(own))
    }
}

/// The local sharing state for the host window: updated twice a second, and the one place that ends a session whose
/// deadline passed or whose desktop is no longer the one receiving input.
pub struct Session {
    shared: Arc<Shared>,
    link: Arc<Link>,
    thread: Option<thread::JoinHandle<()>>,
    stopping: Arc<AtomicBool>,
}

impl Session {
    #[allow(clippy::too_many_arguments)]
    pub fn start_for_approval(
        active: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
        desktop: bool,
        controller: String,
        deadline: Instant,
        control: Arc<AtomicBool>,
        extras: Arc<AtomicU8>,
        session: String,
        _first: FirstRequest,
    ) -> Result<Self, Error> {
        let session = Self::open(
            active,
            connected,
            desktop,
            controller,
            Some(deadline),
            control,
            extras,
            false,
            session,
        )?;
        Ok(session)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_access(
        active: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
        desktop: bool,
        controller: String,
        deadline: Option<Instant>,
        control: Arc<AtomicBool>,
        extras: Arc<AtomicU8>,
        audio: bool,
        session: String,
    ) -> Result<Self, Error> {
        let session = Self::open(
            active, connected, desktop, controller, deadline, control, extras, audio, session,
        )?;
        session.shared.shown.store(true, Ordering::Release);
        Ok(session)
    }

    #[allow(clippy::too_many_arguments)]
    fn open(
        active: Arc<AtomicBool>,
        connected: Arc<AtomicBool>,
        desktop: bool,
        controller: String,
        deadline: Option<Instant>,
        control: Arc<AtomicBool>,
        extras: Arc<AtomicU8>,
        audio: bool,
        session: String,
    ) -> Result<Self, Error> {
        // Refuse to share when no visible Stop can exist: no host window, or not the desktop receiving input.
        let refuse = |why: &str| -> Result<Self, Error> {
            active.store(false, Ordering::Release);
            Err(why.to_owned().into())
        };
        let Some(link) = link().filter(|link| link.hosted()) else {
            return refuse("No host window to show the sharing card and Stop");
        };
        if desktop && !link.desktop_ok() {
            return refuse("The input desktop is not the one being shared");
        }
        let shared = Arc::new(Shared {
            active,
            connected,
            control,
            extras,
            desktop,
            controller,
            session,
            audio: AtomicBool::new(audio),
            deadline: Mutex::new(deadline),
            shown: AtomicBool::new(false),
        });
        if let Ok(mut slot) = link.session.lock() {
            *slot = Some(shared.clone());
        }
        let stopping = Arc::new(AtomicBool::new(false));
        let (watch, watch_link, watch_stop) = (shared.clone(), link.clone(), stopping.clone());
        let thread = thread::spawn(move || {
            let mut last: Option<SessionState> = None;
            let mut sent = Instant::now() - Duration::from_secs(1);
            while !watch_stop.load(Ordering::Acquire) {
                let live = watch.active.load(Ordering::Acquire)
                    && watch.deadline().is_none_or(|end| Instant::now() < end)
                    && (!watch.desktop || watch_link.desktop_ok());
                if !live {
                    watch.active.store(false, Ordering::Release);
                    watch_link.changed.notify_all();
                    return;
                }
                if watch.shown.load(Ordering::Acquire) {
                    let state = watch_link.snapshot(&watch);
                    let same = last.as_ref().is_some_and(|old| {
                        SessionState {
                            remaining_ms: None,
                            ..old.clone()
                        } == SessionState {
                            remaining_ms: None,
                            ..state.clone()
                        }
                    });
                    if !same || sent.elapsed() >= Duration::from_millis(500) {
                        watch_link.send(&ToHost::State(state.clone()));
                        last = Some(state);
                        sent = Instant::now();
                    }
                }
                thread::sleep(Duration::from_millis(50));
            }
        });
        Ok(Self {
            shared,
            link,
            thread: Some(thread),
            stopping,
        })
    }

    /// Asks the person for the first approval (and the optional extras) through the host window.
    pub fn card(&self) -> Asker {
        Asker {
            shared: self.shared.clone(),
            link: self.link.clone(),
        }
    }
    pub fn set_deadline(&self, deadline: Option<Instant>) {
        if let Ok(mut end) = self.shared.deadline.lock() {
            *end = deadline;
        }
    }
    pub fn set_audio(&self, audio: bool) {
        self.shared.audio.store(audio, Ordering::Release);
        // The first approval is over: the host shows the sharing card from the next state on.
        self.shared.shown.store(true, Ordering::Release);
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.shared.active.store(false, Ordering::Release);
        self.stopping.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.link.send(&ToHost::Ended);
        if let Ok(mut slot) = self.link.session.lock() {
            *slot = None;
        }
    }
}

#[derive(Clone)]
pub struct Asker {
    shared: Arc<Shared>,
    link: Arc<Link>,
}
impl Asker {
    /// The first approval. Anything but an explicit Allow once declines.
    pub fn ask_first(
        &self,
        request: &FirstRequest,
        pending: &AtomicBool,
        deadline: Instant,
    ) -> Access {
        let prompt = Prompt {
            id: 0,
            kind: PromptKind::First,
            controller: self.shared.controller.clone(),
            session: self.shared.session.clone(),
            display: request.display.clone(),
            control: request.control,
            unlimited: request.unlimited,
            detail: String::new(),
            deadline_ms: 0,
        };
        match self.link.ask(prompt, pending, deadline) {
            Some(answer) => Access {
                decision: if answer.control && request.control {
                    Decision::Control
                } else {
                    Decision::View
                },
                files: answer.files,
                recording: answer.recording,
                audio: answer.audio,
            },
            None => Access::DECLINED,
        }
    }
}

/// A request for more access during a session. False for everything except an explicit Allow once.
pub fn request_live_permission(
    controller: &str,
    pending: Arc<AtomicBool>,
    deadline: Instant,
    display: &str,
    session: &str,
    scope: LivePermission,
) -> Result<bool, Error> {
    let Some(link) = link() else {
        return Ok(false);
    };
    let prompt = Prompt {
        id: 0,
        kind: PromptKind::More,
        controller: controller.to_owned(),
        session: session.to_owned(),
        display: display.to_owned(),
        control: false,
        unlimited: false,
        detail: scope.detail().to_owned(),
        deadline_ms: 0,
    };
    Ok(link.ask(prompt, &pending, deadline).is_some())
}

/// For the hidden-desktop guard test in `capture`: a request made while the input desktop is not the one being
/// shared declines at once and never reaches the host.
#[cfg(test)]
pub(crate) fn declines_on_a_desktop_that_gets_no_input() -> bool {
    use std::sync::Mutex as StdMutex;
    struct Sink(Arc<StdMutex<usize>>);
    impl Write for Sink {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            *self.0.lock().unwrap() += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let written = Arc::new(StdMutex::new(0));
    let link = Link::new(
        Some(Box::new(Sink(written.clone()))),
        Arc::new(AtomicBool::new(true)),
        true,
    );
    let pending = AtomicBool::new(true);
    let prompt = Prompt {
        id: 0,
        kind: PromptKind::First,
        controller: "guard-test@example.invalid".into(),
        session: "S-0000".into(),
        display: "Primary display".into(),
        control: false,
        unlimited: false,
        detail: String::new(),
        deadline_ms: 0,
    };
    link.ask(prompt, &pending, Instant::now() + Duration::from_secs(1))
        .is_none()
        && *written.lock().unwrap() == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[derive(Clone, Default)]
    struct Sink(Arc<StdMutex<Vec<u8>>>);
    impl Write for Sink {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl Sink {
        fn lines(&self) -> Vec<ToHost> {
            String::from_utf8(self.0.lock().unwrap().clone())
                .unwrap()
                .lines()
                .map(|line| wire::parse_to_host(line).unwrap())
                .collect()
        }
    }

    fn linked() -> (Arc<Link>, Sink, Arc<AtomicBool>) {
        let sink = Sink::default();
        let active = Arc::new(AtomicBool::new(true));
        let link = Arc::new(Link::new(
            Some(Box::new(sink.clone())),
            active.clone(),
            false,
        ));
        (link, sink, active)
    }
    fn prompt() -> Prompt {
        Prompt {
            id: 0,
            kind: PromptKind::First,
            controller: "viewer@example.test".into(),
            session: "S-0000".into(),
            display: "Primary display".into(),
            control: true,
            unlimited: false,
            detail: String::new(),
            deadline_ms: 0,
        }
    }
    /// Asks on a thread and answers `reply` (given the prompt id) from this one.
    fn ask_with(
        link: &Arc<Link>,
        sink: &Sink,
        wait: Duration,
        reply: impl Fn(u32) -> Vec<String>,
    ) -> Option<Answer> {
        let asking = link.clone();
        let pending = Arc::new(AtomicBool::new(true));
        let handle = thread::spawn(move || asking.ask(prompt(), &pending, Instant::now() + wait));
        let id = loop {
            if let Some(ToHost::Prompt(prompt)) = sink.lines().first() {
                break prompt.id;
            }
            thread::sleep(Duration::from_millis(5));
        };
        for line in reply(id) {
            link.handle(&line);
        }
        handle.join().unwrap()
    }
    fn answer(id: u32, allow: bool) -> String {
        wire::encode(&ToHelper::Answer {
            id,
            allow,
            control: true,
            files: true,
            recording: false,
            audio: false,
        })
    }

    #[test]
    fn only_an_explicit_allow_for_the_pending_prompt_approves() {
        let (link, sink, _) = linked();
        let got = ask_with(&link, &sink, Duration::from_secs(5), |id| {
            vec![answer(id, true)]
        });
        let got = got.expect("approved");
        assert!(got.allow && got.control && got.files && !got.recording);
    }

    #[test]
    fn a_decline_wrong_id_or_duplicate_never_approves() {
        let (link, sink, _) = linked();
        assert!(
            ask_with(&link, &sink, Duration::from_secs(5), |id| vec![answer(
                id, false
            )])
            .is_none()
        );
        let (link, sink, _) = linked();
        // A forged id is ignored, so the request runs out of time and declines.
        assert!(
            ask_with(&link, &sink, Duration::from_millis(200), |id| vec![answer(
                id + 7,
                true
            )])
            .is_none()
        );
        // A late answer after the request ended is ignored too.
        link.handle(&answer(1, true));
        assert!(link.pending.lock().unwrap().is_none());
    }

    #[test]
    fn the_first_answer_wins_and_a_second_request_waits_its_turn() {
        let (link, sink, _) = linked();
        let got = ask_with(&link, &sink, Duration::from_secs(5), |id| {
            vec![answer(id, false), answer(id, true)]
        });
        assert!(
            got.is_none(),
            "a later allow cannot override the first answer"
        );
        let (link, _sink, _) = linked();
        *link.pending.lock().unwrap() = Some(Pending {
            id: 9,
            answer: None,
        });
        let pending = AtomicBool::new(true);
        assert!(link
            .ask(prompt(), &pending, Instant::now() + Duration::from_secs(1))
            .is_none());
    }

    #[test]
    fn an_unanswered_request_declines_at_its_deadline_and_is_withdrawn() {
        let (link, sink, _) = linked();
        let started = Instant::now();
        assert!(ask_with(&link, &sink, Duration::from_millis(150), |_| vec![]).is_none());
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(matches!(sink.lines().last(), Some(ToHost::Withdraw { .. })));
    }

    #[test]
    fn a_cancelled_request_declines_even_if_allowed_afterwards() {
        let (link, sink, _) = linked();
        let pending = Arc::new(AtomicBool::new(true));
        let asking = link.clone();
        let flag = pending.clone();
        let handle = thread::spawn(move || {
            asking.ask(prompt(), &flag, Instant::now() + Duration::from_secs(5))
        });
        while sink.lines().is_empty() {
            thread::sleep(Duration::from_millis(5));
        }
        pending.store(false, Ordering::Release);
        link.handle(&answer(1, true));
        assert!(handle.join().unwrap().is_none());
    }

    #[test]
    fn with_no_host_everything_declines() {
        let active = Arc::new(AtomicBool::new(true));
        let link = Link::new(None, active, false);
        let pending = AtomicBool::new(true);
        assert!(link
            .ask(prompt(), &pending, Instant::now() + Duration::from_secs(1))
            .is_none());
    }

    #[test]
    fn a_silent_host_ends_the_session_after_the_lease() {
        let (link, _, active) = linked();
        let now = Instant::now();
        assert!(!link.check_lease(now + Duration::from_secs(LEASE_SECONDS - 1)));
        assert!(active.load(Ordering::Acquire));
        assert!(link.check_lease(now + Duration::from_secs(LEASE_SECONDS + 1)));
        assert!(!active.load(Ordering::Acquire));
        // A heartbeat renews it.
        let (link, _, active) = linked();
        link.handle(&wire::encode(&ToHelper::Alive));
        assert!(!link.check_lease(Instant::now() + Duration::from_secs(2)));
        assert!(active.load(Ordering::Acquire));
    }

    #[test]
    fn stop_a_malformed_line_and_a_closed_pipe_all_end_the_session() {
        for input in [
            wire::encode(&ToHelper::Stop),
            "stop\n".to_owned(),
            "{\"t\":\"nonsense\"}\n".to_owned(),
            format!("{}\n", "x".repeat(MAX_LINE + 10)),
            String::new(),
        ] {
            let (link, _, active) = linked();
            link.read_lines(std::io::Cursor::new(input.clone().into_bytes()));
            assert!(!active.load(Ordering::Acquire), "input {input:?}");
        }
    }

    #[test]
    fn a_stop_while_waiting_declines() {
        let (link, sink, active) = linked();
        let got = ask_with(&link, &sink, Duration::from_secs(5), |_| {
            active.store(false, Ordering::Release);
            vec![]
        });
        assert!(got.is_none());
    }
}
