//! One ordered, bounded input channel per freshly approved controller.
use crate::{input::WindowsInput, renewal::remaining};
use beacon_remote_core::{ControlledDesktop, Input};
use serde::Deserialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use webrtc::data_channel::{DataChannel, DataChannelEvent};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    version: u8,
    session_id: String,
    lease_id: String,
    sequence: u64,
    input: Input,
}
pub struct Authority {
    pub session: String,
    pub display_id: Option<String>,
    pub deadline: Option<Instant>,
    pub epoch: Instant,
    pub lease: Arc<AtomicU64>,
    pub session_active: Arc<AtomicBool>,
    pub peer_active: Arc<AtomicBool>,
    pub connected: Arc<AtomicBool>,
}
impl Authority {
    fn live(&self) -> bool {
        self.session_active.load(Ordering::Acquire)
            && self.peer_active.load(Ordering::Acquire)
            && self.connected.load(Ordering::Acquire)
            && self.deadline.is_none_or(|end| Instant::now() < end)
            && remaining(
                self.lease.load(Ordering::Acquire),
                self.epoch.elapsed().as_millis() as u64,
            )
            .is_some()
            && crate::capture::desktop_receives_input()
    }
}
struct EndAuthority<'a>(&'a Authority);
impl Drop for EndAuthority<'_> {
    fn drop(&mut self) {
        self.0.session_active.store(false, Ordering::Release);
        self.0.peer_active.store(false, Ordering::Release);
    }
}
pub fn start(channel: Arc<dyn DataChannel>, authority: Authority) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let result = run(channel, &authority).await;
        // Control has no transport-recovery authority. Cleanup is owned by run's
        // ControlledDesktop drop; a lost peer always requires new local approval.
        authority.session_active.store(false, Ordering::Release);
        authority.peer_active.store(false, Ordering::Release);
        if result.is_err() {
            println!("Control stopped: invalid input, expired authority or unavailable desktop.");
        }
    })
}
async fn run(channel: Arc<dyn DataChannel>, authority: &Authority) -> Result<(), ()> {
    let display = crate::capture::display(authority.display_id.as_deref()).map_err(|_| ())?;
    let geometry = serde_json::json!({"type":"display", "id":display.id,"width":display.width,"height":display.height});
    let mut desktop = ControlledDesktop::new(WindowsInput::new(display));
    // Declared after the desktop so it revokes capture/transport before any
    // bounded backend destructor waits for a temporarily blocked release.
    let _end_authority = EndAuthority(authority);
    let mut tick = tokio::time::interval(Duration::from_millis(10));
    let mut opened = false;
    let mut sequence = None;
    let mut rate_start = Instant::now();
    let mut messages = 0;
    let mut last_message = Instant::now();
    loop {
        tokio::select! {
            _ = tick.tick() => {
                // Before channel opening allow ICE setup; after opening, any loss
                // of input authority releases held state, without waiting for input.
                if !authority.session_active.load(Ordering::Acquire) || !authority.peer_active.load(Ordering::Acquire) || authority.deadline.is_some_and(|end| Instant::now() >= end) || (opened && (!authority.live() || last_message.elapsed() >= Duration::from_millis(1500))) { return Ok(()); }
                if opened {
                    let lifetime = remaining(authority.lease.load(Ordering::Acquire), authority.epoch.elapsed().as_millis() as u64).ok_or(())?;
                    desktop.renew(&authority.session, &authority.session, lifetime, Instant::now()).map_err(|_| ())?;
                }
            }
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnOpen) => {
                    if !authority.live() { return Err(()); }
                    let lifetime = remaining(authority.lease.load(Ordering::Acquire), authority.epoch.elapsed().as_millis() as u64).ok_or(())?;
                    desktop.start(authority.session.clone(), authority.session.clone(), lifetime, Instant::now()).map_err(|_| ())?;
                    tokio::time::timeout(Duration::from_millis(500), channel.send_text(&geometry.to_string())).await.map_err(|_| ())?.map_err(|_| ())?;
                    opened = true;
                    last_message = Instant::now();
                }
                Some(DataChannelEvent::OnMessage(message)) => {
                    if !opened || !authority.live() || !message.is_string || message.data.len() > 2048 { return Err(()); }
                    if rate_start.elapsed() >= Duration::from_secs(1) { rate_start = Instant::now(); messages = 0; }
                    messages += 1;
                    last_message = Instant::now();
                    if messages > 500 { return Err(()); }
                    let body: Envelope = serde_json::from_slice(&message.data).map_err(|_| ())?;
                    if body.version != 1 || body.session_id != authority.session || body.lease_id != authority.session || body.sequence > 9_007_199_254_740_991 || sequence.is_some_and(|last| body.sequence <= last) { return Err(()); }
                    sequence = Some(body.sequence);
                    desktop.input(&body.session_id, &body.lease_id, &body.input, Instant::now()).map_err(|_| ())?;
                }
                Some(DataChannelEvent::OnClose | DataChannelEvent::OnError) | None => return Ok(()),
                _ => {},
            }
        }
    }
}
