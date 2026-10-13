//! The file channel for one approved session (ADR 0031): the viewer sends files, this computer saves them.
//!
//! Text messages are small JSON control messages; binary messages are `4-byte big-endian id` followed by
//! file bytes. One file at a time. Everything stops when the session's authority ends or sharing is paused.
use crate::{
    files::{self, Incoming, Refusal, MAX_CHUNK, MAX_FILE, MAX_SESSION},
    input_transport::Authority,
};
use serde::Deserialize;
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use webrtc::data_channel::{DataChannel, DataChannelEvent};

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase", deny_unknown_fields)]
enum Control {
    Offer { id: u32, name: String, size: u64 },
    End { id: u32, sha256: String },
    Cancel { id: u32 },
}

/// The per-message decisions, separated from the channel so they can be tested.
pub(crate) struct Receiver {
    folder: std::path::PathBuf,
    current: Option<(u32, Incoming)>,
    total: u64,
}

#[derive(Debug)]
pub(crate) enum Reply {
    Accept(u32),
    Reject(u32, &'static str),
    Done(u32, String),
    Failed(u32, &'static str),
    None,
}

impl Receiver {
    pub(crate) fn new(folder: std::path::PathBuf) -> Self {
        Self {
            folder,
            current: None,
            total: 0,
        }
    }
    pub(crate) fn active(&self) -> bool {
        self.current.is_some()
    }
    /// Drops any partial file (pause, cancel, disconnect).
    pub(crate) fn abort(&mut self) {
        if self.current.take().is_some() {
            files::set_status("File transfer stopped");
        }
    }
    pub(crate) fn control(&mut self, message: &[u8], paused: bool) -> Result<Reply, ()> {
        match serde_json::from_slice::<Control>(message).map_err(|_| ())? {
            Control::Offer { id, name, size } => {
                if paused {
                    return Ok(Reply::Reject(id, "paused"));
                }
                if self.current.is_some() {
                    return Ok(Reply::Reject(id, Refusal::Busy.code()));
                }
                if size > MAX_FILE {
                    return Ok(Reply::Reject(id, Refusal::TooLarge.code()));
                }
                if self.total + size > MAX_SESSION {
                    return Ok(Reply::Reject(id, Refusal::SessionFull.code()));
                }
                match Incoming::begin(&self.folder, &name, size) {
                    Ok(incoming) => {
                        files::set_status(&format!("Receiving {}", incoming.final_name()));
                        self.current = Some((id, incoming));
                        Ok(Reply::Accept(id))
                    }
                    Err(refusal) => Ok(Reply::Reject(id, refusal.code())),
                }
            }
            Control::End { id, sha256 } => {
                let Some((current, incoming)) = self.current.take() else {
                    return Ok(Reply::None);
                };
                if current != id {
                    self.current = Some((current, incoming));
                    return Ok(Reply::None);
                }
                let size = incoming.written();
                match incoming.finish(&sha256) {
                    Ok(name) => {
                        self.total += size;
                        files::set_status(&format!("Received {name}"));
                        Ok(Reply::Done(id, name))
                    }
                    Err(_) => {
                        files::set_status("A file did not arrive intact and was discarded");
                        Ok(Reply::Failed(id, "incomplete"))
                    }
                }
            }
            Control::Cancel { id } => {
                if self
                    .current
                    .as_ref()
                    .is_some_and(|(current, _)| *current == id)
                {
                    self.abort();
                }
                Ok(Reply::None)
            }
        }
    }
    pub(crate) fn chunk(&mut self, message: &[u8]) -> Result<Reply, ()> {
        if message.len() <= 4 || message.len() > 4 + MAX_CHUNK {
            return Err(());
        }
        let id = u32::from_be_bytes([message[0], message[1], message[2], message[3]]);
        let Some((current, incoming)) = self.current.as_mut() else {
            return Ok(Reply::None);
        };
        if *current != id {
            return Ok(Reply::None);
        }
        if incoming.write(&message[4..]).is_err() {
            self.current = None;
            files::set_status("A file could not be saved and was discarded");
            return Ok(Reply::Failed(id, "write"));
        }
        Ok(Reply::None)
    }
}

pub fn start(channel: Arc<dyn DataChannel>, authority: Authority) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if run(channel, &authority).await.is_err() {
            println!("File transfer stopped: invalid message, expired authority or no folder.");
        }
    })
}

async fn send(channel: &Arc<dyn DataChannel>, value: serde_json::Value) -> Result<(), ()> {
    tokio::time::timeout(
        Duration::from_millis(500),
        channel.send_text(&value.to_string()),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())
}

async fn run(channel: Arc<dyn DataChannel>, authority: &Authority) -> Result<(), ()> {
    let folder = files::received_folder().ok_or(())?;
    let mut receiver = Receiver::new(folder);
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    let mut opened = false;
    let mut last_message = Instant::now();
    loop {
        tokio::select! {
            _ = tick.tick() => {
                if !authority.session_active.load(Ordering::Acquire)
                    || !authority.peer_active.load(Ordering::Acquire)
                    || authority.deadline.is_some_and(|end| Instant::now() >= end)
                    || (opened && !authority.live())
                {
                    receiver.abort();
                    return Ok(());
                }
                if receiver.active() && crate::pause::is_paused() {
                    receiver.abort();
                    send(&channel, serde_json::json!({"t":"paused"})).await?;
                }
                if receiver.active() && last_message.elapsed() >= Duration::from_secs(30) {
                    receiver.abort();
                }
            }
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnOpen) => {
                    if !authority.live() { return Err(()); }
                    opened = true;
                    last_message = Instant::now();
                    send(&channel, serde_json::json!({"t":"ready","maxFile":MAX_FILE,"chunk":MAX_CHUNK})).await?;
                }
                Some(DataChannelEvent::OnMessage(message)) => {
                    if !opened || !authority.live() { return Err(()); }
                    last_message = Instant::now();
                    let reply = if message.is_string {
                        if message.data.len() > 2048 { return Err(()); }
                        receiver.control(&message.data, crate::pause::is_paused())?
                    } else {
                        if crate::pause::is_paused() { receiver.abort(); continue; }
                        receiver.chunk(&message.data)?
                    };
                    match reply {
                        Reply::Accept(id) => send(&channel, serde_json::json!({"t":"accept","id":id})).await?,
                        Reply::Reject(id, reason) => send(&channel, serde_json::json!({"t":"reject","id":id,"reason":reason})).await?,
                        Reply::Done(id, name) => send(&channel, serde_json::json!({"t":"done","id":id,"name":name})).await?,
                        Reply::Failed(id, reason) => send(&channel, serde_json::json!({"t":"failed","id":id,"reason":reason})).await?,
                        Reply::None => {}
                    }
                }
                Some(DataChannelEvent::OnClose | DataChannelEvent::OnError) | None => {
                    receiver.abort();
                    return Ok(());
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn folder() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "beacon-ft-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn chunk(id: u32, bytes: &[u8]) -> Vec<u8> {
        let mut message = id.to_be_bytes().to_vec();
        message.extend_from_slice(bytes);
        message
    }
    fn hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn one_file_at_a_time_and_a_good_file_completes() {
        let dir = folder();
        let mut receiver = Receiver::new(dir.clone());
        let data = b"hello world".to_vec();
        let offer = br#"{"t":"offer","id":1,"name":"hi.txt","size":11}"#;
        assert!(matches!(
            receiver.control(offer, false),
            Ok(Reply::Accept(1))
        ));
        // A second offer while one is open is refused.
        let second = br#"{"t":"offer","id":3,"name":"two.txt","size":5}"#;
        assert!(matches!(
            receiver.control(second, false),
            Ok(Reply::Reject(3, "busy"))
        ));
        // Bytes for another id are ignored.
        assert!(matches!(receiver.chunk(&chunk(9, b"zzz")), Ok(Reply::None)));
        assert!(matches!(receiver.chunk(&chunk(1, &data)), Ok(Reply::None)));
        let end = format!(r#"{{"t":"end","id":1,"sha256":"{}"}}"#, hex(&data));
        assert!(
            matches!(receiver.control(end.as_bytes(), false), Ok(Reply::Done(1, name)) if name == "hi.txt")
        );
        assert_eq!(std::fs::read(dir.join("hi.txt")).unwrap(), data);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pause_oversize_garbage_and_cancel_leave_nothing() {
        let dir = folder();
        let mut receiver = Receiver::new(dir.clone());
        let offer = br#"{"t":"offer","id":1,"name":"a.bin","size":10}"#;
        assert!(matches!(
            receiver.control(offer, true),
            Ok(Reply::Reject(1, "paused"))
        ));
        let huge = br#"{"t":"offer","id":1,"name":"a.bin","size":99999999999}"#;
        assert!(matches!(
            receiver.control(huge, false),
            Ok(Reply::Reject(1, "too-large"))
        ));
        assert!(receiver
            .control(b"{\"t\":\"offer\",\"extra\":1}", false)
            .is_err());
        assert!(receiver.control(b"not json", false).is_err());
        assert!(matches!(
            receiver.control(offer, false),
            Ok(Reply::Accept(1))
        ));
        assert!(receiver.chunk(&chunk(1, &[1, 2, 3])).is_ok());
        assert!(
            receiver.chunk(&[0, 0, 0, 1]).is_err(),
            "an empty chunk is a protocol error"
        );
        receiver
            .control(br#"{"t":"cancel","id":1}"#, false)
            .unwrap();
        assert!(!receiver.active());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_session_cannot_receive_more_than_its_total() {
        let dir = folder();
        let mut receiver = Receiver::new(dir.clone());
        receiver.total = MAX_SESSION - 3;
        let offer = br#"{"t":"offer","id":1,"name":"a.bin","size":10}"#;
        assert!(matches!(
            receiver.control(offer, false),
            Ok(Reply::Reject(1, "session-full"))
        ));
        let _ = std::fs::remove_dir_all(dir);
    }
}
