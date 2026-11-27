//! The `beacon-ui-tree-v1` data channel (ADR 0064). The viewer sends `{ "type": "ui-tree-request", "id": <uuid> }` and gets
//! back the bounded interface tree of the foreground window or a refusal. Reading the screen's structure is its own
//! permission: the person at this computer approves it for this connection (the UI-tree bit in the shared flags), and
//! until then every request is answered `denied`. It only reads: names, roles, states and boxes, never what was typed
//! and never a password field's name. Contents are never logged.

use crate::files_transport::UI_TREE_BIT;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use webrtc::data_channel::{DataChannel, DataChannelEvent};

/// A request is an id and a type; anything longer is not one.
pub const MAX_MESSAGE: usize = 256;
/// One read a second: a tree is more work than a pixel, and a viewer has no need to poll faster.
pub const MIN_GAP: Duration = Duration::from_secs(1);

/// What to do with one message, decided before anything is read.
#[derive(Debug, PartialEq)]
pub enum Decision {
    /// Answer now (a refusal).
    Reply(Value),
    /// Read the window, then answer this id with the tree.
    Read(String),
}

fn refusal(id: &str, reason: &str) -> Value {
    json!({"type": "ui-tree", "id": id, "ok": false, "reason": reason})
}

/// Decides one message. `Err` means the message is not a valid request, which ends the channel.
pub fn decide(
    message: &[u8],
    flags: &AtomicU8,
    paused: bool,
    last_read: &mut Option<Instant>,
    now: Instant,
) -> Result<Decision, ()> {
    if message.len() > MAX_MESSAGE {
        return Err(());
    }
    let value: Value = serde_json::from_slice(message).map_err(|_| ())?;
    let object = value.as_object().ok_or(())?;
    if object.len() != 2 || object.get("type").and_then(Value::as_str) != Some("ui-tree-request") {
        return Err(());
    }
    let id = object.get("id").and_then(Value::as_str).ok_or(())?;
    uuid::Uuid::parse_str(id).map_err(|_| ())?;
    if paused || flags.load(Ordering::Acquire) & UI_TREE_BIT == 0 {
        return Ok(Decision::Reply(refusal(id, "denied")));
    }
    if last_read.is_some_and(|at| now.duration_since(at) < MIN_GAP) {
        return Ok(Decision::Reply(refusal(id, "busy")));
    }
    *last_read = Some(now);
    Ok(Decision::Read(id.to_string()))
}

/// What one read gave: the tree, whether the node limit cut it, and the display the window is on when known.
pub type Read = (Value, bool, Option<Value>);

/// The answer once the window has been read, or could not be.
pub fn finish(id: &str, result: Result<Read, String>) -> Value {
    match result {
        Ok((tree, truncated, display)) => {
            let mut reply = json!({"type": "ui-tree", "id": id, "ok": true, "truncated": truncated, "tree": tree});
            if let Some(display) = display {
                reply["display"] = display;
            }
            reply
        }
        Err(_) => refusal(id, "unavailable"),
    }
}

/// The foreground window's tree. A failure carries no detail: it could name a window.
#[cfg(windows)]
fn read_foreground() -> Result<Read, String> {
    // SAFETY: asks Windows which top-level window is in front; a null handle means there is none.
    let hwnd = unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
    if hwnd.is_null() {
        return Err("no window".into());
    }
    let (tree, truncated) = beacon_remote_session::ui_tree::read_window(hwnd as isize)
        .map_err(|_| "unreadable".to_string())?;
    Ok((
        tree,
        truncated,
        beacon_remote_session::ui_tree::display_of(hwnd as isize),
    ))
}

#[cfg(not(windows))]
fn read_foreground() -> Result<Read, String> {
    Err("not supported".into())
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
            println!("UI tree channel stopped: invalid message or expired authority.");
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
    let mut last_read: Option<Instant> = None;
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if (opened && !authority.live()) || (!opened && started.elapsed() > Duration::from_secs(60)) {
                    return Ok(());
                }
            }
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnMessage(message)) => {
                    if !authority.live() {
                        return Ok(());
                    }
                    if !message.is_string {
                        return Err(());
                    }
                    let reply = match decide(&message.data[..], flags, crate::pause::is_paused(), &mut last_read, Instant::now())? {
                        Decision::Reply(reply) => reply,
                        Decision::Read(id) => {
                            // The read talks to other programs, so it never runs on the channel's own task.
                            let result = tokio::task::spawn_blocking(read_foreground)
                                .await
                                .unwrap_or_else(|_| Err("read failed".into()));
                            // Authority may have ended while reading; a tree is not sent after that.
                            if !authority.live() {
                                return Ok(());
                            }
                            finish(&id, result)
                        }
                    };
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

    const ID: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";
    fn request() -> Vec<u8> {
        format!(r#"{{"type":"ui-tree-request","id":"{ID}"}}"#).into_bytes()
    }

    #[test]
    fn without_approval_every_request_is_denied_and_nothing_is_read() {
        let flags = AtomicU8::new(0);
        let mut last = None;
        let now = Instant::now();
        assert_eq!(
            decide(&request(), &flags, false, &mut last, now),
            Ok(Decision::Reply(refusal(ID, "denied")))
        );
        assert!(last.is_none(), "a denied request does not start the clock");
        // Other approvals do not count.
        let others = AtomicU8::new(!UI_TREE_BIT);
        assert_eq!(
            decide(&request(), &others, false, &mut last, now),
            Ok(Decision::Reply(refusal(ID, "denied")))
        );
    }

    #[test]
    fn an_approved_request_reads_once_a_second_and_pause_stops_it() {
        let flags = AtomicU8::new(UI_TREE_BIT);
        let mut last = None;
        let now = Instant::now();
        assert_eq!(
            decide(&request(), &flags, false, &mut last, now),
            Ok(Decision::Read(ID.into()))
        );
        assert_eq!(
            decide(
                &request(),
                &flags,
                false,
                &mut last,
                now + Duration::from_millis(500)
            ),
            Ok(Decision::Reply(refusal(ID, "busy")))
        );
        assert_eq!(
            decide(&request(), &flags, false, &mut last, now + MIN_GAP),
            Ok(Decision::Read(ID.into()))
        );
        assert_eq!(
            decide(&request(), &flags, true, &mut last, now + MIN_GAP * 5),
            Ok(Decision::Reply(refusal(ID, "denied")))
        );
    }

    #[test]
    fn anything_but_a_plain_request_ends_the_channel() {
        let flags = AtomicU8::new(UI_TREE_BIT);
        let now = Instant::now();
        let long = format!(
            r#"{{"type":"ui-tree-request","id":"{ID}","pad":"{}"}}"#,
            "x".repeat(300)
        );
        for bad in [
            "".to_string(),
            "not json".to_string(),
            "[]".to_string(),
            r#"{"type":"ui-tree-request"}"#.to_string(),
            r#"{"type":"ui-tree-request","id":"nope"}"#.to_string(),
            format!(r#"{{"type":"ui-tree-request","id":"{ID}","selector":"password"}}"#),
            format!(r#"{{"type":"clipboard","id":"{ID}"}}"#),
            long,
        ] {
            assert_eq!(
                decide(bad.as_bytes(), &flags, false, &mut None, now),
                Err(()),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_answer_is_a_tree_or_unavailable_with_no_detail() {
        let tree = json!({"role": "window"});
        let ok = finish(
            ID,
            Ok((
                tree.clone(),
                true,
                Some(json!({"x": -1920, "y": 0, "width": 1920, "height": 1080})),
            )),
        );
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["truncated"], true);
        assert_eq!(ok["tree"], tree);
        assert_eq!(ok["display"]["x"], -1920);
        // With no display known the field is simply absent.
        assert!(finish(ID, Ok((tree.clone(), false, None)))
            .get("display")
            .is_none());
        let bad = finish(ID, Err("C:\\Users\\someone\\secret window".into()));
        assert_eq!(bad, refusal(ID, "unavailable"));
        assert!(!bad.to_string().contains("secret"));
    }
}
