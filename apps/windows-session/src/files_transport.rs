//! The file channel for one approved session (ADR 0031). The viewer can send files, which this computer saves;
//! the person at this computer can pick a file to send to the helper, who must accept it.
//!
//! Text messages are small JSON control messages; binary messages are `4-byte big-endian id` followed by
//! file bytes. The viewer's transfer ids are odd and this computer's are even. One file per direction at a
//! time. Everything stops when the session's authority ends or sharing is paused.
use crate::{
    files::{self, Incoming, Outgoing, Refusal, MAX_CHUNK, MAX_FILE, MAX_SESSION},
    input_transport::Authority,
};
use serde::Deserialize;
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use webrtc::data_channel::{DataChannel, DataChannelEvent};

// The `reason` the viewer may attach to a rejection is accepted (the format is strict) but not needed here.
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase", deny_unknown_fields)]
enum Control {
    Offer {
        id: u32,
        name: String,
        size: u64,
        // The viewer could not use a kept partial copy and wants the file started again.
        #[serde(default)]
        fresh: bool,
    },
    End {
        id: u32,
        sha256: String,
    },
    // The viewer announces that it started or stopped recording (only valid when recording was allowed).
    Recording {
        on: bool,
    },
    Cancel {
        id: u32,
    },
    // The helper's answers to a file this computer offered.
    Accept {
        id: u32,
    },
    Reject {
        id: u32,
        #[serde(default)]
        reason: Option<String>,
    },
    Done {
        id: u32,
    },
    Failed {
        id: u32,
        #[serde(default)]
        reason: Option<String>,
    },
}

fn parse(message: &[u8]) -> Result<Control, ()> {
    serde_json::from_slice(message).map_err(|_| ())
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
    /// Accepted, carrying on from `offset` bytes whose SHA-256 is given, for the viewer to check.
    Resume(u32, u64, String),
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
    /// The connection to the viewer was lost while the session goes on: keep the partial file for a reconnecting
    /// viewer to carry on from. Pause, cancel and the end of the session delete it instead (`abort`).
    pub(crate) fn interrupted(&mut self) {
        if let Some((_, incoming)) = self.current.take() {
            files::set_status("File transfer interrupted");
            incoming.park();
        }
    }
    /// Drops any partial file (pause, cancel, the end of the session).
    pub(crate) fn abort(&mut self) {
        if self.current.take().is_some() {
            files::set_status("File transfer stopped");
        }
    }
    #[cfg(test)]
    pub(crate) fn control(&mut self, message: &[u8], paused: bool) -> Result<Reply, ()> {
        self.handle(parse(message)?, paused)
    }
    fn handle(&mut self, control: Control, paused: bool) -> Result<Reply, ()> {
        match control {
            Control::Offer {
                id,
                name,
                size,
                fresh,
            } => {
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
                if fresh {
                    files::discard_matching(&self.folder, &name, size);
                } else if let Some(incoming) = Incoming::resume(&self.folder, &name, size) {
                    let (offset, sha256) = incoming.resume_point();
                    files::set_status(&format!("Resuming {}", incoming.final_name()));
                    self.current = Some((id, incoming));
                    return Ok(Reply::Resume(id, offset, sha256));
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
            Control::Recording { .. } => Ok(Reply::None),
            // Answers about this computer's own offers are the outbound side's business.
            Control::Accept { .. }
            | Control::Reject { .. }
            | Control::Done { .. }
            | Control::Failed { .. } => Ok(Reply::None),
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

/// What goes onto the channel next.
#[derive(Debug, PartialEq)]
pub(crate) enum Frame {
    Text(serde_json::Value),
    Binary(Vec<u8>),
}

enum Stage {
    Idle,
    Offered(Outgoing, Instant),
    Streaming(Outgoing),
    Ending(Instant, String),
}

/// A file this computer is sending to the helper: offer, wait for their accept, stream, then wait for their
/// confirmation. Separated from the channel so it can be tested.
pub(crate) struct Outbound {
    stage: Stage,
    id: u32,
    announced: u64,
}

impl Outbound {
    pub(crate) fn new() -> Self {
        Self {
            stage: Stage::Idle,
            id: 0,
            announced: 101,
        }
    }
    pub(crate) fn idle(&self) -> bool {
        matches!(self.stage, Stage::Idle)
    }
    pub(crate) fn streaming(&self) -> bool {
        matches!(self.stage, Stage::Streaming(_))
    }
    pub(crate) fn start(&mut self, path: &std::path::Path) -> Option<Frame> {
        if !self.idle() {
            files::set_status("Wait for the current file to finish first");
            return None;
        }
        let outgoing = match Outgoing::open(path) {
            Ok(outgoing) => outgoing,
            Err(_) => {
                files::set_status("That file cannot be sent");
                return None;
            }
        };
        self.id += 2;
        files::set_status(&format!("Offering {} to the helper", outgoing.name));
        let frame = Frame::Text(
            serde_json::json!({"t":"send","id":self.id,"name":outgoing.name,"size":outgoing.size}),
        );
        self.stage = Stage::Offered(outgoing, Instant::now());
        Some(frame)
    }
    fn finish(&mut self, status: &str) {
        self.stage = Stage::Idle;
        files::set_status(status);
    }
    fn current_id(&self) -> Option<u32> {
        match &self.stage {
            Stage::Offered(..) | Stage::Streaming(_) | Stage::Ending(..) => Some(self.id),
            Stage::Idle => None,
        }
    }
    fn name(&self) -> String {
        match &self.stage {
            Stage::Offered(outgoing, _) | Stage::Streaming(outgoing) => outgoing.name.clone(),
            Stage::Ending(_, name) => name.clone(),
            Stage::Idle => "the file".into(),
        }
    }
    /// The helper's answer. Returns nothing to send.
    fn answer(&mut self, control: &Control) {
        let Some(current) = self.current_id() else {
            return;
        };
        match control {
            Control::Accept { id } if *id == current => {
                if let Stage::Offered(outgoing, _) = std::mem::replace(&mut self.stage, Stage::Idle)
                {
                    files::set_status(&format!("Sending {} · 0%", outgoing.name));
                    self.stage = Stage::Streaming(outgoing);
                }
            }
            Control::Reject { id, .. } | Control::Cancel { id } if *id == current => {
                let name = self.name();
                self.finish(&format!("The helper did not take {name}"));
            }
            Control::Done { id } if *id == current => {
                let name = self.name();
                self.finish(&format!("Sent {name}"));
            }
            Control::Failed { id, .. } if *id == current => {
                self.finish("The helper's copy did not arrive intact");
            }
            _ => {}
        }
    }
    /// The next chunk, or the closing message with the checksum.
    pub(crate) fn pump(&mut self) -> Option<Frame> {
        let Stage::Streaming(outgoing) = &mut self.stage else {
            return None;
        };
        match outgoing.next_chunk() {
            Ok(Some(bytes)) => {
                let percent = outgoing.sent() * 100 / outgoing.size;
                if percent != self.announced {
                    self.announced = percent;
                    files::set_status(&format!("Sending {} · {percent}%", outgoing.name));
                }
                let mut frame = self.id.to_be_bytes().to_vec();
                frame.extend_from_slice(&bytes);
                Some(Frame::Binary(frame))
            }
            Ok(None) => match outgoing.digest() {
                Ok(sha256) => {
                    let id = self.id;
                    self.stage = Stage::Ending(Instant::now(), outgoing.name.clone());
                    Some(Frame::Text(
                        serde_json::json!({"t":"end","id":id,"sha256":sha256}),
                    ))
                }
                Err(_) => {
                    let id = self.id;
                    self.finish("The file changed while it was being sent");
                    Some(Frame::Text(serde_json::json!({"t":"cancel","id":id})))
                }
            },
            Err(_) => {
                let id = self.id;
                self.finish("The file could not be read");
                Some(Frame::Text(serde_json::json!({"t":"cancel","id":id})))
            }
        }
    }
    /// Stops whatever is in flight (pause, session ending) and tells the helper.
    pub(crate) fn abort(&mut self) -> Option<Frame> {
        let id = self.current_id()?;
        self.finish("File transfer stopped");
        Some(Frame::Text(serde_json::json!({"t":"cancel","id":id})))
    }
    /// An offer nobody answers, or a finish nobody confirms, does not hold the channel forever.
    pub(crate) fn expire(&mut self) {
        let stale = match &self.stage {
            Stage::Offered(_, since) => since.elapsed() >= Duration::from_secs(60),
            Stage::Ending(since, _) => since.elapsed() >= Duration::from_secs(30),
            _ => false,
        };
        if stale {
            self.finish("The helper did not answer");
        }
    }
}

/// What the person at the computer allowed for this session on the extras channel.
#[derive(Clone, Copy)]
pub struct Permissions {
    pub files: bool,
    pub recording: bool,
}

pub fn start(
    channel: Arc<dyn DataChannel>,
    authority: Authority,
    permissions: Permissions,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let result = run(channel, &authority, permissions).await;
        files::set_recording(false);
        if result.is_err() {
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

async fn send_frame(channel: &Arc<dyn DataChannel>, frame: Frame) -> Result<(), ()> {
    match frame {
        Frame::Text(value) => send(channel, value).await,
        Frame::Binary(bytes) => tokio::time::timeout(
            Duration::from_millis(500),
            channel.send(bytes::BytesMut::from(&bytes[..])),
        )
        .await
        .map_err(|_| ())?
        .map_err(|_| ()),
    }
}

async fn run(
    channel: Arc<dyn DataChannel>,
    authority: &Authority,
    permissions: Permissions,
) -> Result<(), ()> {
    let folder = files::received_folder().ok_or(())?;
    // Left over from a session that ended abnormally.
    files::sweep_stale(&folder);
    let mut receiver = Receiver::new(folder);
    let mut outbound = Outbound::new();
    // The browser's buffer fills when the network is slower than the disk; wait for it to drain.
    let mut blocked = false;
    let mut pump = tokio::time::interval(Duration::from_millis(2));
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
                    // A viewer that is only reconnecting leaves the session alive: keep what has arrived for it.
                    if authority.session_active.load(Ordering::Acquire)
                        && !authority.peer_active.load(Ordering::Acquire)
                        && !authority.deadline.is_some_and(|end| Instant::now() >= end)
                    {
                        receiver.interrupted();
                    } else {
                        receiver.abort();
                    }
                    if let Some(frame) = outbound.abort() { let _ = send_frame(&channel, frame).await; }
                    return Ok(());
                }
                if (receiver.active() || !outbound.idle()) && crate::pause::is_paused() {
                    receiver.abort();
                    if let Some(frame) = outbound.abort() { send_frame(&channel, frame).await?; }
                    send(&channel, serde_json::json!({"t":"paused"})).await?;
                }
                if receiver.active() && last_message.elapsed() >= Duration::from_secs(30) {
                    receiver.abort();
                }
                outbound.expire();
                // A file the person at this computer picked in the sharing window.
                if opened && permissions.files && outbound.idle() {
                    if let Some(path) = files::take_send() {
                        if crate::pause::is_paused() {
                            files::set_status("Resume sharing before sending a file");
                        } else if let Some(frame) = outbound.start(&path) {
                            send_frame(&channel, frame).await?;
                        }
                    }
                }
            }
            _ = pump.tick(), if outbound.streaming() && !blocked => {
                for _ in 0..16 {
                    let Some(frame) = outbound.pump() else { break };
                    let last = matches!(frame, Frame::Text(_));
                    send_frame(&channel, frame).await?;
                    if last || blocked { break; }
                }
            }
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnOpen) => {
                    if !authority.live() { return Err(()); }
                    opened = true;
                    last_message = Instant::now();
                    channel.set_buffered_amount_low_threshold(256 * 1024).await.map_err(|_| ())?;
                    channel.set_buffered_amount_high_threshold(1024 * 1024).await.map_err(|_| ())?;
                    send(&channel, serde_json::json!({"t":"ready","maxFile":MAX_FILE,"chunk":MAX_CHUNK,"files":permissions.files,"recording":permissions.recording})).await?;
                }
                Some(DataChannelEvent::OnBufferedAmountHigh) => blocked = true,
                Some(DataChannelEvent::OnBufferedAmountLow) => blocked = false,
                Some(DataChannelEvent::OnMessage(message)) => {
                    if !opened || !authority.live() { return Err(()); }
                    last_message = Instant::now();
                    let reply = if message.is_string {
                        if message.data.len() > 2048 { return Err(()); }
                        let control = parse(&message.data)?;
                        if let Control::Recording { on } = control {
                            // Only the announcement is honoured, and only when it was allowed.
                            if permissions.recording {
                                files::set_recording(on);
                                send(&channel, serde_json::json!({"t":"recording","on":on})).await?;
                            } else {
                                send(&channel, serde_json::json!({"t":"recording","on":false,"denied":true})).await?;
                            }
                            continue;
                        }
                        if !permissions.files {
                            // Without file permission every file message ends the channel's usefulness.
                            if let Control::Offer { id, .. } = control {
                                send(&channel, serde_json::json!({"t":"reject","id":id,"reason":"disabled"})).await?;
                            }
                            continue;
                        }
                        // Even ids are this computer's own offers; odd ids are the viewer's.
                        let ours = match &control {
                            Control::Accept { .. } | Control::Reject { .. } | Control::Done { .. } | Control::Failed { .. } => true,
                            Control::Cancel { id } => id % 2 == 0,
                            _ => false,
                        };
                        if ours {
                            outbound.answer(&control);
                            continue;
                        }
                        receiver.handle(control, crate::pause::is_paused())?
                    } else {
                        if !permissions.files { continue; }
                        if crate::pause::is_paused() { receiver.abort(); continue; }
                        receiver.chunk(&message.data)?
                    };
                    match reply {
                        Reply::Accept(id) => send(&channel, serde_json::json!({"t":"accept","id":id})).await?,
                        Reply::Resume(id, offset, sha256) => send(&channel, serde_json::json!({"t":"accept","id":id,"resume":{"offset":offset,"sha256":sha256}})).await?,
                        Reply::Reject(id, reason) => send(&channel, serde_json::json!({"t":"reject","id":id,"reason":reason})).await?,
                        Reply::Done(id, name) => send(&channel, serde_json::json!({"t":"done","id":id,"name":name})).await?,
                        Reply::Failed(id, reason) => send(&channel, serde_json::json!({"t":"failed","id":id,"reason":reason})).await?,
                        Reply::None => {}
                    }
                }
                Some(DataChannelEvent::OnClose | DataChannelEvent::OnError) | None => {
                    // The connection went; the session may not have. Keep the part for a reconnecting viewer.
                    if authority.session_active.load(Ordering::Acquire) {
                        receiver.interrupted();
                    } else {
                        receiver.abort();
                    }
                    let _ = outbound.abort();
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
    fn an_interrupted_upload_carries_on_from_a_verified_start_and_only_for_the_same_file() {
        let dir = folder();
        let data = b"0123456789abcdef".to_vec();
        let offer = br#"{"t":"offer","id":1,"name":"big.bin","size":16}"#;
        // Half arrives, then the connection is lost while the session goes on.
        let mut first = Receiver::new(dir.clone());
        assert!(matches!(first.control(offer, false), Ok(Reply::Accept(1))));
        first.chunk(&chunk(1, &data[..8])).unwrap();
        first.interrupted();
        // A reconnecting viewer offers the same file: it is told how much is here and the hash of exactly that.
        let mut second = Receiver::new(dir.clone());
        let again = br#"{"t":"offer","id":3,"name":"big.bin","size":16}"#;
        match second.control(again, false) {
            Ok(Reply::Resume(3, 8, sha)) => assert_eq!(sha, hex(&data[..8])),
            other => panic!("expected a resume, got {other:?}"),
        }
        second.chunk(&chunk(3, &data[8..])).unwrap();
        let end = format!(r#"{{"t":"end","id":3,"sha256":"{}"}}"#, hex(&data));
        assert!(matches!(
            second.control(end.as_bytes(), false),
            Ok(Reply::Done(3, _))
        ));
        assert_eq!(std::fs::read(dir.join("big.bin")).unwrap(), data);

        // A different size is a different file: nothing is resumed.
        let mut third = Receiver::new(dir.clone());
        assert!(matches!(third.control(offer, false), Ok(Reply::Accept(1))));
        third.chunk(&chunk(1, &data[..4])).unwrap();
        third.interrupted();
        let other = br#"{"t":"offer","id":5,"name":"big.bin","size":20}"#;
        let mut fourth = Receiver::new(dir.clone());
        assert!(matches!(fourth.control(other, false), Ok(Reply::Accept(5))));
        fourth.abort();
        // Starting again on request throws the kept part away.
        let fresh = br#"{"t":"offer","id":7,"name":"big.bin","size":16,"fresh":true}"#;
        let mut fifth = Receiver::new(dir.clone());
        assert!(matches!(fifth.control(fresh, false), Ok(Reply::Accept(7))));
        fifth.abort();
        // Pause, cancel and the end of the session delete what was kept.
        let mut sixth = Receiver::new(dir.clone());
        assert!(matches!(sixth.control(offer, false), Ok(Reply::Accept(1))));
        sixth.chunk(&chunk(1, &data[..4])).unwrap();
        sixth.interrupted();
        files::discard_parked();
        let mut seventh = Receiver::new(dir.clone());
        assert!(matches!(
            seventh.control(offer, false),
            Ok(Reply::Accept(1))
        ));
        seventh.abort();
        assert!(std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .all(|entry| entry.path().extension().is_none_or(|e| e != "beaconpart")));
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

    #[test]
    fn an_offered_file_waits_for_the_helper_then_streams_and_finishes_on_their_word() {
        let dir = folder();
        let data: Vec<u8> = (0..40_000u32).map(|n| (n % 253) as u8).collect();
        let path = dir.join("log.txt");
        std::fs::write(&path, &data).unwrap();
        let mut outbound = Outbound::new();
        let Some(Frame::Text(offer)) = outbound.start(&path) else {
            panic!("an offer is expected");
        };
        assert_eq!(offer["t"], "send");
        assert_eq!(offer["name"], "log.txt");
        assert_eq!(offer["size"], 40_000);
        let id = offer["id"].as_u64().unwrap() as u32;
        assert_eq!(id % 2, 0, "this computer's ids are even");
        assert!(
            outbound.pump().is_none(),
            "nothing streams before the helper accepts"
        );
        assert!(outbound.start(&path).is_none(), "one file at a time");
        outbound.answer(&parse(format!(r#"{{"t":"accept","id":{id}}}"#).as_bytes()).unwrap());
        let mut bytes = Vec::new();
        let end = loop {
            match outbound.pump().expect("a frame while streaming") {
                Frame::Binary(frame) => {
                    assert_eq!(&frame[..4], &id.to_be_bytes());
                    bytes.extend_from_slice(&frame[4..]);
                }
                Frame::Text(end) => break end,
            }
        };
        assert_eq!(bytes, data);
        assert_eq!(end["t"], "end");
        assert_eq!(end["sha256"], hex(&data));
        assert!(
            !outbound.idle(),
            "still waiting for the helper's confirmation"
        );
        // Someone else's id changes nothing; theirs finishes it.
        outbound.answer(&parse(br#"{"t":"done","id":9}"#).unwrap());
        assert!(!outbound.idle());
        outbound.answer(&parse(format!(r#"{{"t":"done","id":{id}}}"#).as_bytes()).unwrap());
        assert!(outbound.idle());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn declining_pausing_and_unreadable_files_stop_cleanly() {
        let dir = folder();
        let path = dir.join("a.txt");
        std::fs::write(&path, b"hello").unwrap();
        let mut outbound = Outbound::new();
        assert!(outbound.start(&dir.join("missing")).is_none());
        assert!(outbound.start(&dir).is_none(), "a folder is not a file");
        let Some(Frame::Text(offer)) = outbound.start(&path) else {
            panic!()
        };
        let id = offer["id"].as_u64().unwrap();
        outbound.answer(&parse(format!(r#"{{"t":"reject","id":{id}}}"#).as_bytes()).unwrap());
        assert!(outbound.idle());
        // A pause during streaming cancels and tells the helper.
        let Some(Frame::Text(second)) = outbound.start(&path) else {
            panic!()
        };
        let id = second["id"].as_u64().unwrap();
        assert_eq!(id % 2, 0);
        outbound.answer(&parse(format!(r#"{{"t":"accept","id":{id}}}"#).as_bytes()).unwrap());
        assert!(outbound.streaming());
        let Some(Frame::Text(cancel)) = outbound.abort() else {
            panic!()
        };
        assert_eq!(cancel["t"], "cancel");
        assert!(outbound.idle());
        assert!(outbound.abort().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
