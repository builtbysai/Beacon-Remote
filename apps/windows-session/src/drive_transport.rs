//! The `beacon-drive-v1` data channel for P1-4. Every message is one JSON command; the answer is one JSON reply.
//! Nothing runs unless the person at this computer approved drive access for this connection (the drive bit in
//! the shared permission flags) and a folder is configured. Commands run through `drive_exec` under a `Grant`,
//! so the folder boundary, link refusal, read-only rights and expiry all apply to every message.

use crate::drive_exec::execute;
use crate::drive_map::{Grant, Rights};
use crate::drive_wire;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use webrtc::data_channel::{DataChannel, DataChannelEvent};

/// Longest a single mapping may last, matching the protocol's eight hour bound.
const MAX_LIFETIME: Duration = Duration::from_secs(8 * 60 * 60);

/// The folder this computer shares for drive mapping, if one is configured. Without one, every command is refused.
/// `BEACON_DRIVE_FOLDER` names the folder; `BEACON_DRIVE_RIGHTS=write` allows changes, anything else is read-only.
pub fn configured_grant(now: Instant) -> Option<Grant> {
    let (folder, write) = crate::folder_picker::stored_choice()?;
    let rights = if write { Rights::Write } else { Rights::Read };
    Grant::new(folder, rights, MAX_LIFETIME, now)
}

/// The folder grant for this connection. It is filled when the person approves drive access and picks the folder, so
/// nothing needs setting up beforehand; a folder configured in advance is used without asking.
pub type GrantSlot = Arc<Mutex<Option<Grant>>>;

/// A read-only grant for a folder chosen while approving, lasting as long as one mapping may.
pub fn grant_for_chosen_folder(folder: std::path::PathBuf, now: Instant) -> Option<Grant> {
    Grant::new(folder, Rights::Read, MAX_LIFETIME, now)
}

/// The reply to one message. Permission is checked before the message is even parsed.
pub fn answer(message: &[u8], flags: &AtomicU8, grant: Option<&Grant>, now: Instant) -> Value {
    if flags.load(Ordering::Acquire) & DRIVE_BIT == 0 {
        return json!({"type": "refused", "reason": "not-permitted"});
    }
    let Some(grant) = grant else {
        return json!({"type": "refused", "reason": "no-folder"});
    };
    match drive_wire::parse(message) {
        Some(command) => drive_wire::encode(&execute(grant, &command, now)),
        None => json!({"type": "refused", "reason": "invalid"}),
    }
}

use crate::files_transport::DRIVE_BIT;

pub fn start(
    channel: Arc<dyn DataChannel>,
    authority: crate::input_transport::Authority,
    flags: Arc<AtomicU8>,
    slot: GrantSlot,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let result = run(channel.clone(), &authority, &flags, &slot).await;
        let _ = tokio::time::timeout(Duration::from_millis(500), channel.close()).await;
        if result.is_err() {
            println!("Drive channel stopped: invalid message or expired authority.");
        }
    })
}

async fn run(
    channel: Arc<dyn DataChannel>,
    authority: &crate::input_transport::Authority,
    flags: &AtomicU8,
    slot: &GrantSlot,
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
                    // Binary and oversized messages are not commands; they end the channel.
                    if !message.is_string || message.data.len() > drive_wire::MAX_MESSAGE {
                        return Err(());
                    }
                    let grant = slot.lock().map_err(|_| ())?.clone();
                    let reply = answer(&message.data[..], flags, grant.as_ref(), Instant::now());
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
    fn a_folder_picked_at_approval_is_read_only_and_a_missing_one_is_refused() {
        let root = std::env::temp_dir().join(format!("beacon-drive-picked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.txt"), b"x").unwrap();
        let now = Instant::now();
        let grant = grant_for_chosen_folder(root.clone(), now).unwrap();
        let flags = AtomicU8::new(DRIVE_BIT);
        let write = br#"{\"op\":\"mkdir\",\"path\":[\"new\"]}"#;
        let reply = answer(write, &flags, Some(&grant), now);
        assert_eq!(reply["type"], "refused");
        assert!(!root.join("new").exists());
        assert!(grant_for_chosen_folder(root.join("missing"), now).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nothing_runs_without_drive_permission_or_a_folder() {
        let flags = AtomicU8::new(0);
        let list = br#"{"op":"list","path":[]}"#;
        assert_eq!(
            answer(list, &flags, None, Instant::now()),
            json!({"type": "refused", "reason": "not-permitted"})
        );
        flags.store(DRIVE_BIT, Ordering::Release);
        assert_eq!(
            answer(list, &flags, None, Instant::now()),
            json!({"type": "refused", "reason": "no-folder"})
        );
    }

    #[test]
    fn a_permitted_list_runs_under_the_grant_and_bad_messages_are_refused() {
        let root = std::env::temp_dir().join(format!("beacon-drive-answer-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("a.txt"), b"x").unwrap();
        let now = Instant::now();
        let grant = Grant::new(root.clone(), Rights::Read, MAX_LIFETIME, now).unwrap();
        let flags = AtomicU8::new(DRIVE_BIT);
        let listed = answer(br#"{"op":"list","path":[]}"#, &flags, Some(&grant), now);
        assert_eq!(listed["type"], "entries");
        assert_eq!(listed["entries"][0]["name"], "a.txt");
        assert_eq!(
            answer(br#"{"op":"list","path":[".."]}"#, &flags, Some(&grant), now),
            json!({"type": "refused", "reason": "invalid"})
        );
        // Turning permission off takes effect on the very next message.
        flags.store(0, Ordering::Release);
        assert_eq!(
            answer(br#"{"op":"list","path":[]}"#, &flags, Some(&grant), now)["reason"],
            "not-permitted"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
