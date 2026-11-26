//! The host's end of the conversation with the capture helper (ADR 0059). The helper is headless: it reports what the
//! person must decide and what is being shared, and the host window shows it. This module reads those reports from
//! the helper's stdout, keeps the latest, and writes the person's answers and the heartbeat back to its stdin.
//!
//! Nothing here approves anything. An answer is only a message; the helper decides whether it still applies.
use beacon_remote_session::ui_protocol::{self as wire, Prompt, SessionState, ToHelper, ToHost};
use std::{
    io::{BufRead, Read, Write},
    process::{ChildStdin, ChildStdout},
    sync::{Arc, Mutex, Weak},
    thread,
    time::{Duration, Instant},
};

/// What the window should show right now.
#[derive(Clone, Default)]
pub struct View {
    /// A request waiting for an answer, and when it was received.
    pub prompt: Option<(Prompt, Instant)>,
    /// A session in progress.
    pub session: Option<SessionState>,
}
impl View {
    pub fn active(&self) -> bool {
        self.prompt.is_some() || self.session.is_some()
    }
}

#[derive(Default)]
struct Hub {
    view: View,
    pipe: Option<Weak<Mutex<ChildStdin>>>,
    generation: u64,
}
static HUB: Mutex<Hub> = Mutex::new(Hub {
    view: View {
        prompt: None,
        session: None,
    },
    pipe: None,
    generation: 0,
});

fn hub() -> std::sync::MutexGuard<'static, Hub> {
    HUB.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts reading a new helper's reports. Only one helper runs at a time.
pub fn attach(stdout: ChildStdout, pipe: &Arc<Mutex<ChildStdin>>) {
    let generation = {
        let mut hub = hub();
        hub.generation += 1;
        hub.view = View::default();
        hub.pipe = Some(Arc::downgrade(pipe));
        hub.generation
    };
    let writer = Arc::downgrade(pipe);
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        loop {
            let mut line = String::new();
            let read = Read::take(&mut reader, wire::MAX_LINE as u64 + 2).read_line(&mut line);
            if !matches!(read, Ok(count) if count > 0) {
                break;
            }
            if !line.ends_with('\n') {
                // A report this long is not ours: end the helper rather than guess.
                if let Some(pipe) = writer.upgrade() {
                    write(&pipe, &ToHelper::Stop);
                }
                break;
            }
            let Ok(message) = wire::parse_to_host(&line) else {
                continue;
            };
            let mut hub = hub();
            if hub.generation != generation {
                return;
            }
            match message {
                ToHost::Prompt(prompt) => hub.view.prompt = Some((prompt, Instant::now())),
                ToHost::Withdraw { id } => {
                    if hub.view.prompt.as_ref().is_some_and(|(p, _)| p.id == id) {
                        hub.view.prompt = None;
                    }
                }
                ToHost::State(state) => hub.view.session = Some(state),
                ToHost::Ended => hub.view = View::default(),
            }
        }
        let mut hub = hub();
        if hub.generation == generation {
            // The helper is gone: nothing is being asked and nothing is being shared.
            hub.view = View::default();
            hub.pipe = None;
        }
    });
}

fn write(pipe: &Mutex<ChildStdin>, message: &ToHelper) {
    if let Ok(mut pipe) = pipe.lock() {
        let _ = pipe
            .write_all(wire::encode(message).as_bytes())
            .and_then(|()| pipe.flush());
    }
}

fn current_pipe() -> Option<Arc<Mutex<ChildStdin>>> {
    hub().pipe.as_ref().and_then(Weak::upgrade)
}

/// The latest reports.
pub fn view() -> View {
    hub().view.clone()
}

/// A message for the helper, if one is running.
pub fn send(message: &ToHelper) {
    if let Some(pipe) = current_pipe() {
        write(&pipe, message);
    }
}

/// The host window's heartbeat. The window's own UI thread sends it, so a hung window stops it.
pub fn alive() {
    send(&ToHelper::Alive);
}

/// The person's answer to the pending request. Decline is `allow: false`.
pub fn answer(id: u32, allow: bool, control: bool, files: bool, recording: bool, audio: bool) {
    if let Some(pipe) = current_pipe() {
        write(
            &pipe,
            &ToHelper::Answer {
                id,
                allow,
                control: allow && control,
                files: allow && files,
                recording: allow && recording,
                audio: allow && audio,
            },
        );
    }
    // The request is closed on this side now; a second click cannot answer it again.
    let mut hub = hub();
    if hub.view.prompt.as_ref().is_some_and(|(p, _)| p.id == id) {
        hub.view.prompt = None;
    }
}

/// Shows a made-up state, for the preview test.
#[cfg(test)]
pub(crate) fn seed(view: View) {
    hub().view = view;
}

/// How long is left to answer a prompt, from when it arrived.
pub fn time_left(prompt: &(Prompt, Instant)) -> Duration {
    Duration::from_millis(prompt.0.deadline_ms).saturating_sub(prompt.1.elapsed())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_left_counts_down_from_when_the_request_arrived() {
        let prompt = Prompt {
            id: 1,
            kind: wire::PromptKind::First,
            controller: "a@example.test".into(),
            session: "S-1".into(),
            display: "Primary display".into(),
            control: false,
            unlimited: false,
            detail: String::new(),
            deadline_ms: 5_000,
        };
        let now = Instant::now();
        let left = time_left(&(prompt.clone(), now));
        assert!(left <= Duration::from_secs(5) && left > Duration::from_secs(4));
        let old = (
            prompt,
            now.checked_sub(Duration::from_secs(9)).unwrap_or(now),
        );
        assert!(time_left(&old) <= Duration::from_secs(5));
    }
}
