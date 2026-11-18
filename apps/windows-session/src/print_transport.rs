//! The `beacon-print-v1` data channel for P2-1. Each message is a JSON command; each answer is a JSON reply. Nothing
//! is accepted unless the person at this computer approved printing for this connection (the print bit in the
//! shared permission flags). Jobs go through `PrintSession`, which checks the selected printers and sizes, and the
//! final spooler step is `print_submit::submit`. Printers are the owner's selection, read from
//! `%LOCALAPPDATA%\BeaconRemote\print-printers.txt` (one name per line).

use crate::files_transport::PRINT_BIT;
use crate::print_session::{Message, PrintSession, Reply};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;
use webrtc::data_channel::{DataChannel, DataChannelEvent};

/// Largest single chunk message, matching the drive channel's bound.
pub const MAX_MESSAGE: usize = 512 * 1024;
const MAX_JOB: u64 = crate::print_submit::MAX_JOB_BYTES as u64;

/// The printers the owner selected for remote printing. Empty when nothing is selected.
pub fn selected_printers() -> Vec<String> {
    let Some(base) = std::env::var_os("LOCALAPPDATA") else {
        return Vec::new();
    };
    let path = std::path::PathBuf::from(base)
        .join("BeaconRemote")
        .join("print-printers.txt");
    std::fs::read_to_string(path)
        .map(|text| {
            text.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse(value: &Value) -> Option<Message> {
    let id = u32::try_from(value.get("id")?.as_u64()?).ok()?;
    Some(match value.get("op")?.as_str()? {
        "begin" => Message::Begin {
            id,
            printer: value.get("printer")?.as_str()?.to_string(),
            size: value.get("size")?.as_u64()?,
        },
        "chunk" => Message::Chunk {
            id,
            bytes: crate::drive_wire::decode_base64(value.get("data")?.as_str()?)?,
        },
        "print" => Message::Print { id },
        "cancel" => Message::Cancel { id },
        _ => return None,
    })
}

fn encode(reply: Reply) -> Value {
    match reply {
        Reply::Accepted => json!({"type": "accepted"}),
        Reply::Received { total } => json!({"type": "received", "total": total}),
        Reply::Printed => json!({"type": "printed"}),
        Reply::Cancelled => json!({"type": "cancelled"}),
        Reply::Refused(reason) => json!({"type": "refused", "reason": reason}),
    }
}

/// Answers one message. Permission is checked before the message is parsed, so a refused channel keeps nothing.
pub fn answer(message: &[u8], flags: &AtomicU8, session: &mut PrintSession) -> Value {
    if flags.load(Ordering::Acquire) & PRINT_BIT == 0 {
        return json!({"type": "refused", "reason": "not-permitted"});
    }
    let Ok(value) = serde_json::from_slice::<Value>(message) else {
        return json!({"type": "refused", "reason": "invalid"});
    };
    let Some(parsed) = parse(&value) else {
        return json!({"type": "refused", "reason": "invalid"});
    };
    let reply = session.handle(parsed, |printer, bytes| {
        crate::print_submit::submit(printer, "Beacon Remote job", bytes)
            .map(|_| ())
            .map_err(|_| "spooler")
    });
    encode(reply)
}

pub fn start(
    channel: Arc<dyn DataChannel>,
    authority: crate::input_transport::Authority,
    flags: Arc<AtomicU8>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut session = PrintSession::new(selected_printers(), MAX_JOB);
        let result = run(channel.clone(), &authority, &flags, &mut session).await;
        let _ = tokio::time::timeout(Duration::from_millis(500), channel.close()).await;
        if result.is_err() {
            println!("Print channel stopped: invalid message or expired authority.");
        }
    })
}

async fn run(
    channel: Arc<dyn DataChannel>,
    authority: &crate::input_transport::Authority,
    flags: &AtomicU8,
    session: &mut PrintSession,
) -> Result<(), ()> {
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if !authority.live() {
                    return Ok(());
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
                    let reply = answer(&message.data[..], flags, session);
                    tokio::time::timeout(Duration::from_millis(500), channel.send_text(&reply.to_string()))
                        .await
                        .map_err(|_| ())?
                        .map_err(|_| ())?;
                }
                Some(DataChannelEvent::OnClose | DataChannelEvent::OnError) | None => return Ok(()),
                Some(_) => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_accepted_without_print_permission() {
        let flags = AtomicU8::new(0);
        let mut session = PrintSession::new(vec!["Office Laser".into()], MAX_JOB);
        let reply = answer(
            br#"{"op":"begin","id":1,"printer":"Office Laser","size":4}"#,
            &flags,
            &mut session,
        );
        assert_eq!(reply, json!({"type": "refused", "reason": "not-permitted"}));
    }

    #[test]
    fn malformed_messages_are_refused_without_touching_jobs() {
        let flags = AtomicU8::new(PRINT_BIT);
        let mut session = PrintSession::new(vec!["Office Laser".into()], MAX_JOB);
        for bad in [
            &b"not json"[..],
            br#"{"op":"print"}"#,
            br#"{"op":"chunk","id":1,"data":"!!"}"#,
        ] {
            assert_eq!(
                answer(bad, &flags, &mut session),
                json!({"type": "refused", "reason": "invalid"})
            );
        }
    }

    #[test]
    fn a_permitted_begin_is_accepted_for_a_selected_printer() {
        let flags = AtomicU8::new(PRINT_BIT);
        let mut session = PrintSession::new(vec!["Office Laser".into()], MAX_JOB);
        let reply = answer(
            br#"{"op":"begin","id":1,"printer":"Office Laser","size":4}"#,
            &flags,
            &mut session,
        );
        assert_eq!(reply, json!({"type": "accepted"}));
    }
}
