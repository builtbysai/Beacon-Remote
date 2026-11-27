//! The `beacon-clipboard-v1` data channel (ADR 0060). Each message is one JSON command and each answer one JSON reply.
//! What may move is set by the person at this computer (`clipboard::Mode`); writing the clipboard also needs their
//! approval for this connection (the clipboard bit in the shared permission flags), which Automatic mode counts as.
//! Contents are never logged. In Automatic mode a change made at this computer is pushed to the viewer unless the
//! program that made it marked it as protected.

use crate::clipboard::{ClipboardText, Mode, MAX_WRITE_CHARS};
use crate::files_transport::CLIPBOARD_BIT;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use webrtc::data_channel::{DataChannel, DataChannelEvent};

/// Largest message accepted: 8,000 characters is at most 32,000 bytes of UTF-8, plus the envelope.
pub const MAX_MESSAGE: usize = 64 * 1024;

/// One write or read a second and thirty a minute; more is refused, and the channel stays open.
pub struct Limiter {
    last: Option<Instant>,
    window: Instant,
    count: u32,
}

impl Limiter {
    pub fn new(now: Instant) -> Self {
        Self {
            last: None,
            window: now,
            count: 0,
        }
    }

    pub fn allow(&mut self, now: Instant) -> bool {
        if now.duration_since(self.window) >= Duration::from_secs(60) {
            self.window = now;
            self.count = 0;
        }
        if self.count >= 30
            || self
                .last
                .is_some_and(|at| now.duration_since(at) < Duration::from_secs(1))
        {
            return false;
        }
        self.last = Some(now);
        self.count += 1;
        true
    }
}

fn refused(reason: &str) -> Value {
    json!({"type": "refused", "reason": reason})
}

/// Whether writing is approved: Automatic counts as approval, otherwise the connection's clipboard bit does.
pub fn approved(mode: Mode, flags: &AtomicU8) -> bool {
    mode == Mode::Auto || flags.load(Ordering::Acquire) & CLIPBOARD_BIT != 0
}

/// What is true when a message arrives.
#[derive(Clone, Copy)]
pub struct Context<'a> {
    pub mode: Mode,
    pub flags: &'a AtomicU8,
    pub paused: bool,
    pub now: Instant,
}

/// Answers one message. The mode and permission are checked before the contents are looked at, and the contents
/// never leave this function except into the callbacks.
pub fn answer(
    message: &[u8],
    context: &Context,
    limiter: &mut Limiter,
    write: impl FnOnce(&str) -> bool,
    read: impl FnOnce() -> Option<ClipboardText>,
) -> Value {
    let Context {
        mode,
        flags,
        paused,
        now,
    } = *context;
    let Ok(value) = serde_json::from_slice::<Value>(message) else {
        return refused("invalid");
    };
    let Some(op) = value.get("op").and_then(Value::as_str) else {
        return refused("invalid");
    };
    // A viewer may always ask what the setting is, so it can show the right state.
    if op == "hello" {
        return json!({"type": "mode", "mode": mode.as_str(), "approved": approved(mode, flags)});
    }
    if mode == Mode::Off {
        return refused("off");
    }
    if paused {
        return refused("paused");
    }
    match op {
        "write" => {
            let Some(text) = value.get("text").and_then(Value::as_str) else {
                return refused("invalid");
            };
            if text.chars().count() > MAX_WRITE_CHARS {
                return refused("too-long");
            }
            if !approved(mode, flags) {
                return refused("needs-approval");
            }
            if !limiter.allow(now) {
                return refused("too-fast");
            }
            if write(text) {
                json!({"type": "written", "chars": text.chars().count()})
            } else {
                refused("unavailable")
            }
        }
        "read" => {
            if !limiter.allow(now) {
                return refused("too-fast");
            }
            match read() {
                Some(clip) => {
                    json!({"type": "clipboard", "text": clip.text, "truncated": clip.truncated})
                }
                None => {
                    json!({"type": "clipboard", "text": "", "truncated": false, "unavailable": true})
                }
            }
        }
        _ => refused("invalid"),
    }
}

pub fn start(
    channel: Arc<dyn DataChannel>,
    authority: crate::input_transport::Authority,
    flags: Arc<AtomicU8>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let result = run(channel.clone(), &authority, &flags).await;
        let _ = tokio::time::timeout(Duration::from_millis(500), channel.close()).await;
        if result.is_err() {
            println!("Clipboard channel stopped: invalid message or expired authority.");
        }
    })
}

async fn send(channel: &Arc<dyn DataChannel>, reply: &Value) -> Result<(), ()> {
    tokio::time::timeout(
        Duration::from_millis(500),
        channel.send_text(&reply.to_string()),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())
}

async fn run(
    channel: Arc<dyn DataChannel>,
    authority: &crate::input_transport::Authority,
    flags: &AtomicU8,
) -> Result<(), ()> {
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    // The channel is created before the connection is up, so authority is only judged once it has opened;
    // a channel that never opens is given up on after a minute.
    let mut opened = false;
    let started = Instant::now();
    let mut limiter = Limiter::new(started);
    let mut announced: Option<Mode> = None;
    let mut seen = crate::clipboard::sequence();
    let mut own = None::<u32>;
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if (opened && !authority.live()) || (!opened && started.elapsed() > Duration::from_secs(60)) {
                    return Ok(());
                }
                if !opened {
                    continue;
                }
                let mode = crate::clipboard::mode();
                // A change of the setting is told to the viewer at once, so its buttons follow.
                if announced != Some(mode) {
                    announced = Some(mode);
                    send(&channel, &json!({"type": "mode", "mode": mode.as_str(), "approved": approved(mode, flags)})).await?;
                }
                // Automatic: a copy made here goes to the viewer, unless it is ours or marked protected.
                let now_seq = crate::clipboard::sequence();
                if now_seq != seen {
                    seen = now_seq;
                    if mode == Mode::Auto && !crate::pause::is_paused() && own != Some(now_seq) && !crate::clipboard::protected() {
                        if let Some(clip) = crate::clipboard::read_text() {
                            if !clip.text.is_empty() {
                                send(&channel, &json!({"type": "clipboard", "text": clip.text, "truncated": clip.truncated, "auto": true})).await?;
                            }
                        }
                    }
                }
            }
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnMessage(message)) => {
                    if !authority.live() {
                        return Ok(());
                    }
                    if !message.is_string || message.data.len() > MAX_MESSAGE {
                        return Err(());
                    }
                    let mode = crate::clipboard::mode();
                    let mut wrote = false;
                    let reply = answer(
                        &message.data[..],
                        &Context {
                            mode,
                            flags,
                            paused: crate::pause::is_paused(),
                            now: Instant::now(),
                        },
                        &mut limiter,
                        |text| {
                            let ok = crate::clipboard::write_text(text);
                            wrote = ok;
                            ok
                        },
                        crate::clipboard::read_text,
                    );
                    if wrote {
                        // Our own write must not bounce straight back to the viewer in Automatic mode.
                        own = Some(crate::clipboard::sequence());
                        seen = crate::clipboard::sequence();
                        crate::clipboard::note_write();
                        println!("A viewer set the clipboard.");
                    }
                    send(&channel, &reply).await?;
                }
                Some(DataChannelEvent::OnClose | DataChannelEvent::OnError) | None => return Ok(()),
                Some(DataChannelEvent::OnOpen) => opened = true,
                Some(_) => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(
        message: &str,
        mode: Mode,
        bits: u8,
        paused: bool,
        limiter: &mut Limiter,
        now: Instant,
    ) -> (Value, Option<String>) {
        let flags = AtomicU8::new(bits);
        let mut written = None;
        let reply = answer(
            message.as_bytes(),
            &Context {
                mode,
                flags: &flags,
                paused,
                now,
            },
            limiter,
            |text| {
                written = Some(text.to_string());
                true
            },
            || {
                Some(ClipboardText {
                    text: "from the computer".into(),
                    truncated: false,
                })
            },
        );
        (reply, written)
    }

    #[test]
    fn off_refuses_everything_but_telling_the_viewer_it_is_off() {
        let now = Instant::now();
        let mut limiter = Limiter::new(now);
        for message in [r#"{"op":"write","text":"x"}"#, r#"{"op":"read"}"#] {
            let (reply, written) = ask(message, Mode::Off, CLIPBOARD_BIT, false, &mut limiter, now);
            assert_eq!(reply, refused("off"));
            assert!(written.is_none());
        }
        let (reply, _) = ask(r#"{"op":"hello"}"#, Mode::Off, 0, false, &mut limiter, now);
        assert_eq!(
            reply,
            json!({"type": "mode", "mode": "off", "approved": false})
        );
    }

    #[test]
    fn button_mode_writes_only_after_the_connection_is_approved() {
        let now = Instant::now();
        let mut limiter = Limiter::new(now);
        let (reply, written) = ask(
            r#"{"op":"write","text":"hello"}"#,
            Mode::Button,
            0,
            false,
            &mut limiter,
            now,
        );
        assert_eq!(reply, refused("needs-approval"));
        assert!(written.is_none());
        let (reply, written) = ask(
            r#"{"op":"write","text":"hello"}"#,
            Mode::Button,
            CLIPBOARD_BIT,
            false,
            &mut limiter,
            now,
        );
        assert_eq!(reply, json!({"type": "written", "chars": 5}));
        assert_eq!(written.as_deref(), Some("hello"));
    }

    #[test]
    fn automatic_mode_counts_as_the_approval() {
        let now = Instant::now();
        let mut limiter = Limiter::new(now);
        let (reply, written) = ask(
            r#"{"op":"write","text":"hi"}"#,
            Mode::Auto,
            0,
            false,
            &mut limiter,
            now,
        );
        assert_eq!(reply, json!({"type": "written", "chars": 2}));
        assert_eq!(written.as_deref(), Some("hi"));
    }

    #[test]
    fn a_paused_share_moves_nothing() {
        let now = Instant::now();
        let mut limiter = Limiter::new(now);
        let (reply, written) = ask(
            r#"{"op":"write","text":"hi"}"#,
            Mode::Auto,
            CLIPBOARD_BIT,
            true,
            &mut limiter,
            now,
        );
        assert_eq!(reply, refused("paused"));
        assert!(written.is_none());
        let (reply, _) = ask(r#"{"op":"read"}"#, Mode::Button, 0, true, &mut limiter, now);
        assert_eq!(reply, refused("paused"));
    }

    #[test]
    fn reading_follows_the_mode_and_needs_no_separate_approval() {
        let now = Instant::now();
        let mut limiter = Limiter::new(now);
        let (reply, _) = ask(
            r#"{"op":"read"}"#,
            Mode::Button,
            0,
            false,
            &mut limiter,
            now,
        );
        assert_eq!(
            reply,
            json!({"type": "clipboard", "text": "from the computer", "truncated": false})
        );
    }

    #[test]
    fn long_malformed_and_unknown_messages_are_refused_without_writing() {
        let now = Instant::now();
        let mut limiter = Limiter::new(now);
        let long = format!(
            r#"{{"op":"write","text":"{}"}}"#,
            "a".repeat(MAX_WRITE_CHARS + 1)
        );
        let exact = format!(
            r#"{{"op":"write","text":"{}"}}"#,
            "a".repeat(MAX_WRITE_CHARS)
        );
        let (reply, written) = ask(&long, Mode::Auto, 0, false, &mut limiter, now);
        assert_eq!(reply, refused("too-long"));
        assert!(written.is_none());
        let (reply, _) = ask(&exact, Mode::Auto, 0, false, &mut limiter, now);
        assert_eq!(reply["type"], "written");
        for bad in [
            "not json",
            r#"{"op":5}"#,
            r#"{"op":"write"}"#,
            r#"{"op":"delete"}"#,
            r#"{}"#,
        ] {
            let (reply, written) = ask(
                bad,
                Mode::Auto,
                CLIPBOARD_BIT,
                false,
                &mut limiter,
                now + Duration::from_secs(5),
            );
            assert_eq!(reply, refused("invalid"), "{bad}");
            assert!(written.is_none());
        }
    }

    #[test]
    fn writes_are_limited_to_one_a_second_and_thirty_a_minute() {
        let start = Instant::now();
        let mut limiter = Limiter::new(start);
        assert!(limiter.allow(start));
        assert!(!limiter.allow(start + Duration::from_millis(500)));
        assert!(limiter.allow(start + Duration::from_millis(1100)));
        let mut limiter = Limiter::new(start);
        let mut allowed = 0;
        // One try every 1.1 seconds for 59 seconds: only thirty are let through.
        for step in 0..54 {
            if limiter.allow(start + Duration::from_millis(step * 1100)) {
                allowed += 1;
            }
        }
        assert_eq!(allowed, 30);
        // A new minute starts fresh.
        assert!(limiter.allow(start + Duration::from_secs(130)));
    }

    #[test]
    fn a_refused_write_reports_too_fast_without_touching_the_clipboard() {
        let now = Instant::now();
        let mut limiter = Limiter::new(now);
        let (first, written) = ask(
            r#"{"op":"write","text":"a"}"#,
            Mode::Auto,
            0,
            false,
            &mut limiter,
            now,
        );
        assert_eq!(first["type"], "written");
        assert!(written.is_some());
        let (second, written) = ask(
            r#"{"op":"write","text":"b"}"#,
            Mode::Auto,
            0,
            false,
            &mut limiter,
            now + Duration::from_millis(100),
        );
        assert_eq!(second, refused("too-fast"));
        assert!(written.is_none());
    }
}
