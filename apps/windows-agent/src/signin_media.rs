//! The sign-in worker's separate, single-peer media path. No ordinary grants,
//! capture picker, clipboard/files/audio, remote commands or peer recovery.
use crate::{
    signin_capture::SignInCapture,
    signin_input::SignInInput,
    signin_scope::SignInScope,
    signin_signaling::{Candidate, Command, Event, Ready, SignInSignaling},
    HostError,
};
use beacon_remote_session::{encoder::Encoder, pixels};
use rtc::{
    interceptor::Registry,
    media::Sample,
    media_stream::MediaStreamTrack,
    peer_connection::configuration::{
        interceptor_registry::register_default_interceptors,
        media_engine::{MediaEngine, MIME_TYPE_H264},
        setting_engine::{SctpMaxMessageSize, SettingEngineBuilder},
    },
    rtp_transceiver::rtp_sender::{
        RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters,
        RtpCodecKind,
    },
};
use std::{
    future::Future,
    os::windows::io::AsRawHandle,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tokio::{sync::mpsc, time::timeout};
use webrtc::{
    data_channel::{DataChannel, DataChannelEvent, RTCDataChannelInit},
    media_stream::{
        track_local::{static_sample::TrackLocalStaticSample, TrackLocal},
        track_remote::TrackRemote,
    },
    peer_connection::{
        PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
        RTCIceCandidateInit, RTCIceServer, RTCIceTransportPolicy, RTCPeerConnectionIceEvent,
        RTCPeerConnectionState, RTCSessionDescription,
    },
    rtp_transceiver::RTCRtpTransceiverDirection,
    runtime::TokioRuntime,
};
use windows_sys::Win32::System::Threading::WaitForSingleObject;
use zeroize::Zeroizing;

const WIDTH: u32 = 1280;
const HEIGHT: u32 = 720;
const FPS: u32 = 25;
const SSRC: u32 = 7_230_003;
const INTERVAL: Duration = Duration::from_millis(40);
const INPUT_CHANNEL: &str = "beacon-signin-input-v1";
fn rejected() -> HostError {
    "Sign-in media ended or unavailable".into()
}
struct EndScope(Arc<SignInScope>);
impl Drop for EndScope {
    fn drop(&mut self) {
        self.0.stop();
    }
}

// All awaits that can start/emit media must be cancellable on local authority
// loss as well as bounded against an unresponsive transport/library.
async fn checked<T>(
    scope: &SignInScope,
    media: bool,
    future: impl Future<Output = Result<T, impl std::error::Error + Send + Sync + 'static>>,
) -> Result<T, HostError> {
    let check = || {
        if media {
            scope.authorize()
        } else {
            scope.authorize_signaling()
        }
    };
    checked_by(check, future).await
}
async fn checked_by<T>(
    check: impl Fn() -> Result<(), HostError>,
    future: impl Future<Output = Result<T, impl std::error::Error + Send + Sync + 'static>>,
) -> Result<T, HostError> {
    check()?;
    tokio::pin!(future);
    let deadline = tokio::time::sleep(Duration::from_secs(2));
    tokio::pin!(deadline);
    let mut tick = tokio::time::interval(Duration::from_millis(10));
    loop {
        tokio::select! { biased;
            _=&mut deadline=>return Err(rejected()),
            _=tick.tick()=>check()?,
            result=&mut future=>{let value=result.map_err(|_|rejected())?;check()?;return Ok(value);}
        }
    }
}
struct Handler {
    scope: Arc<SignInScope>,
    candidates: mpsc::Sender<RTCIceCandidateInit>,
}
fn local_candidate(
    event: RTCPeerConnectionIceEvent,
) -> Result<Option<RTCIceCandidateInit>, HostError> {
    let mut candidate = event.candidate.to_json().map_err(|_| rejected())?;
    if candidate.candidate.is_empty() {
        return Ok(None);
    }
    if candidate.candidate.len() > 2048 {
        return Err(rejected());
    }
    // The SDK can omit mid/index. Both m-lines share the BUNDLE transport;
    // identify its first (video) m-line instead of sending an unusable candidate.
    if candidate.sdp_mid.as_ref().is_none_or(|mid| mid.is_empty()) {
        candidate.sdp_mid = None;
        candidate.sdp_mline_index = Some(0);
    }
    Ok(Some(candidate))
}
#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if self.scope.authorize_signaling().is_err() {
            return;
        }
        match local_candidate(event) {
            Ok(None) => {}
            Ok(Some(candidate)) => {
                if self.candidates.try_send(candidate).is_err() {
                    self.scope.stop();
                }
            }
            _ => self.scope.stop(),
        }
    }
    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        match state {
            RTCPeerConnectionState::Connected => {
                if self.scope.connect_peer().is_err() {
                    self.scope.stop();
                }
            }
            RTCPeerConnectionState::Disconnected
            | RTCPeerConnectionState::Failed
            | RTCPeerConnectionState::Closed => self.scope.stop(),
            _ => {}
        }
    }
    async fn on_data_channel(&self, channel: Arc<dyn DataChannel>) {
        // Only our one locally created ordered input lane is supported.
        self.scope.stop();
        let _ = timeout(Duration::from_millis(250), channel.close()).await;
    }
    async fn on_track(&self, _track: Arc<dyn TrackRemote>) {
        self.scope.stop();
    }
}
struct Packet {
    bytes: Zeroizing<Vec<u8>>,
}
struct Completion {
    input: AtomicBool,
    video: AtomicBool,
}
impl Completion {
    fn complete(&self) -> bool {
        self.input.load(Ordering::Acquire) && self.video.load(Ordering::Acquire)
    }
}
struct VideoDone(Arc<Completion>);
impl Drop for VideoDone {
    fn drop(&mut self) {
        if !thread::panicking() {
            self.0.video.store(true, Ordering::Release);
        }
    }
}

// This thread owns COM/encoder/DXGI resources. It never starts them until the
// actual peer-connected callback has opened the separate native media gate.
fn video(scope: Arc<SignInScope>, packets: mpsc::Sender<Packet>) -> Result<(), HostError> {
    let _end = EndScope(scope.clone());
    scope.authorize()?;
    crate::signin_worker::trace("video: starting capture");
    let mut capture = match SignInCapture::start(scope.clone()) {
        Ok(capture) => capture,
        Err(error) => {
            crate::signin_worker::trace(&format!("video: capture could not start: {error}"));
            return Err(error);
        }
    };
    scope.authorize()?;
    crate::signin_worker::trace("video: capture started, starting encoder");
    let mut encoder = match Encoder::new(WIDTH, HEIGHT, FPS, 2_500_000) {
        Ok(encoder) => encoder,
        Err(error) => {
            crate::signin_worker::trace(&format!("video: encoder could not start: {error}"));
            return Err(error);
        }
    };
    crate::signin_worker::trace("video: encoder started");
    let mut nv12 = Zeroizing::new(vec![0u8; (WIDTH * HEIGHT * 3 / 2) as usize]);
    let mut index = 0u64;
    loop {
        scope.authorize()?;
        let started = Instant::now();
        let frame = match capture.next_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) => {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(error) => {
                crate::signin_worker::trace(&format!("video: capturing a frame failed: {error}"));
                return Err(error);
            }
        };
        if index == 0 {
            crate::signin_worker::trace("video: first frame captured");
        }
        pixels::nv12(
            &frame.image.bgra,
            frame.image.width,
            frame.image.height,
            &mut nv12,
            WIDTH,
            HEIGHT,
        )?;
        drop(frame);
        scope.authorize()?;
        let encoded = match encoder.encode(&nv12, index) {
            Ok(encoded) => encoded,
            Err(error) => {
                crate::signin_worker::trace(&format!("video: encoding failed: {error}"));
                return Err(error);
            }
        };
        if index == 0 {
            crate::signin_worker::trace("video: first frame encoded");
        }
        // Own every packet in zeroizing memory before rechecking authority.
        let encoded = encoded
            .into_iter()
            .map(|frame| Packet {
                bytes: Zeroizing::new(frame.bytes),
            })
            .collect::<Vec<_>>();
        scope.authorize()?;
        for packet in encoded {
            scope.authorize()?;
            packets.try_send(packet).map_err(|_| rejected())?;
        }
        index = index.checked_add(1).ok_or_else(rejected)?;
        if let Some(delay) = INTERVAL.checked_sub(started.elapsed()) {
            thread::sleep(delay);
        }
    }
}

async fn input(
    channel: Arc<dyn DataChannel>,
    scope: Arc<SignInScope>,
    cleanup: Arc<Completion>,
) -> Result<(), HostError> {
    let _end = EndScope(scope.clone());
    let (lease, instance, console) = scope.signaling_binding()?;
    let mut tick = tokio::time::interval(Duration::from_millis(10));
    let mut adapter = None::<SignInInput>;
    let mut rate = Instant::now();
    let mut messages = 0u32;
    let result=async {loop {tokio::select! {biased;
        _=tick.tick()=>{scope.authorize_signaling()?;if adapter.is_some(){
            scope.authorize()?;
            if let Some((sequence,outcome))=scope.attention.result(crate::signin_scope::tick()) {
                let reply=serde_json::json!({"type":"secure-attention","version":1,"scope":"windows:sign-in","leaseId":lease,"instanceId":instance,"consoleSessionId":console,"sequence":sequence,"status":outcome});
                checked(&scope,true,channel.send_text(&reply.to_string())).await?;
            }
        }},
        event=channel.poll()=>match event {
            Some(DataChannelEvent::OnOpen)=>{
                if adapter.is_some(){return Err(rejected());}
                scope.authorize()?;
                cleanup.input.store(false,Ordering::Release);
                // Own the adapter before geometry/send can fail, so cleanup
                // cannot accidentally report success from the empty case.
                adapter=Some(SignInInput::start(scope.clone())?);
                let display=adapter.as_ref().ok_or_else(rejected)?.geometry()?;
                let geometry=serde_json::json!({"type":"display","version":1,"scope":"windows:sign-in","leaseId":lease,"instanceId":instance,"consoleSessionId":console,
                    "id":display.id,"width":display.width,"height":display.height,"encodedWidth":WIDTH,"encodedHeight":HEIGHT,"cursorComposited":true});
                checked(&scope,true,channel.send_text(&geometry.to_string())).await?;
            },
            Some(DataChannelEvent::OnMessage(message))=>{
                scope.authorize()?;
                if !message.is_string || message.data.len()>4096{return Err(rejected());}
                if rate.elapsed()>=Duration::from_secs(1){rate=Instant::now();messages=0;}
                messages+=1;if messages>500{return Err(rejected());}
                adapter.as_mut().ok_or_else(rejected)?.receive(message.data.to_vec())?;
            },
            Some(DataChannelEvent::OnClose|DataChannelEvent::OnError)|None=>return Err(rejected()),
            _=>{},
        }
    }}}.await;
    // Input's watchdog/Drop owns bounded release on the original desktop.
    scope.stop();
    if let Some(adapter) = adapter {
        let until = Instant::now() + Duration::from_millis(3100);
        while !adapter.cleanup_confirmed() && Instant::now() < until {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        cleanup
            .input
            .store(adapter.cleanup_confirmed(), Ordering::Release);
        drop(adapter);
    } else {
        cleanup.input.store(true, Ordering::Release);
    }
    result
}

fn configured_peer(
    ready: &Ready,
    handler: Arc<dyn PeerConnectionEventHandler>,
) -> Result<(RTCRtpCodecParameters, PeerConnectionBuilder<String>), HostError> {
    let mut engine = MediaEngine::default();
    let codec = RTCRtpCodecParameters {
        rtp_codec: RTCRtpCodec {
            mime_type: MIME_TYPE_H264.into(),
            clock_rate: 90000,
            channels: 0,
            sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                .into(),
            rtcp_feedback: vec![],
        },
        payload_type: 102,
    };
    engine.register_codec(codec.clone(), RtpCodecKind::Video)?;
    let registry = register_default_interceptors(Registry::new(), &mut engine)?;
    let ice: Vec<_> = ready
        .ice_servers
        .iter()
        .map(|server| RTCIceServer {
            urls: server.urls.clone(),
            username: server.username.clone().unwrap_or_default(),
            credential: server.credential.clone().unwrap_or_default(),
        })
        .collect();
    for server in &ice {
        let urls = server.urls().map_err(|_| rejected())?;
        // The selected native RTC stack currently supports TURN over UDP.
        // Reject unsupported TCP/TLS rather than silently ignoring policy.
        if urls
            .iter()
            .any(|url| url.is_secure() || url.proto.to_string() != "udp")
        {
            return Err(rejected());
        }
    }
    let config = RTCConfigurationBuilder::new()
        .with_ice_servers(ice)
        .with_ice_transport_policy(if ready.ice_transport_policy == "relay" {
            RTCIceTransportPolicy::Relay
        } else {
            RTCIceTransportPolicy::All
        })
        .build();
    let settings = SettingEngineBuilder::new()
        .with_sctp_max_message_size(SctpMaxMessageSize::Bounded(4096))
        .with_sctp_max_receive_buffer_size(64 * 1024)
        .build();
    let builder = PeerConnectionBuilder::new()
        .with_configuration(config)
        .with_media_engine(engine)
        .with_interceptor_registry(registry)
        .with_setting_engine(settings)
        .with_data_channel_send_buffer_limit(8192)
        .with_runtime(Arc::new(TokioRuntime))
        .with_handler(handler)
        .with_udp_addrs(vec!["0.0.0.0:0".to_owned()]);
    Ok((codec, builder))
}
fn video_track(codec: RTCRtpCodec) -> Result<Arc<TrackLocalStaticSample>, HostError> {
    Ok(Arc::new(TrackLocalStaticSample::new(
        Instant::now(),
        MediaStreamTrack::new(
            "beacon-signin".into(),
            "beacon-signin-video".into(),
            "Windows sign-in".into(),
            RtpCodecKind::Video,
            vec![RTCRtpEncodingParameters {
                rtp_coding_parameters: RTCRtpCodingParameters {
                    ssrc: Some(SSRC),
                    ..Default::default()
                },
                codec,
                ..Default::default()
            }],
        ),
    )?))
}
async fn peer(
    signaling: &SignInSignaling,
    scope: Arc<SignInScope>,
    ready: Ready,
    cleanup: Arc<Completion>,
) -> Result<(), HostError> {
    scope.authorize_signaling()?;
    let (candidates, mut candidate_receiver) = mpsc::channel(16);
    let (codec, builder) = configured_peer(
        &ready,
        Arc::new(Handler {
            scope: scope.clone(),
            candidates,
        }),
    )?;
    let pc = checked(&scope, false, builder.build()).await?;
    let result=async {
        let track=video_track(codec.rtp_codec)?;
        let sender=checked(&scope,false,pc.add_track(track.clone() as Arc<dyn TrackLocal>)).await?;
        let transceivers=checked(&scope,false,async {Ok::<_,std::io::Error>(pc.get_transceivers().await)}).await?;
        for transceiver in transceivers {checked(&scope,false,transceiver.set_direction(RTCRtpTransceiverDirection::Sendonly)).await?;}
        let channel=checked(&scope,false,pc.create_data_channel(INPUT_CHANNEL,Some(RTCDataChannelInit{ordered:true,..Default::default()}))).await?;
        let input_task=tokio::spawn(input(channel,scope.clone(),cleanup.clone()));
        // Joining input is part of teardown even if any subsequent setup fails.
        let cycle=async {
            let offer=checked(&scope,false,pc.create_offer(None)).await?;
            checked(&scope,false,pc.set_local_description(offer)).await?;
            let description=checked(&scope,false,async {Ok::<_,std::io::Error>(pc.local_description().await)}).await?.ok_or_else(rejected)?;
            signaling.send(Command::Offer{sdp:description.sdp})?;
            let mut answered=false;let mut remote=Vec::<RTCIceCandidateInit>::new();
            let (packets,mut receiver)=mpsc::channel::<Packet>(2);
            let mut video_thread=None::<JoinHandle<()>>;
            let mut tick=tokio::time::interval(Duration::from_millis(10));
            let result=async {loop {tokio::select! {biased;
                _=tick.tick()=>{
                    if let Err(error)=scope.authorize_signaling(){crate::signin_worker::trace(&format!("peer loop: authority check failed: {error}"));return Err(error);}
                    if signaling.ended(){crate::signin_worker::trace("peer loop: signaling has ended");return Err(rejected());}
                    // A lease or signaling metadata alone cannot start capture.
                    if answered && video_thread.is_none() && scope.authorize().is_ok() {
                        let owned_scope=scope.clone();let owned_packets=packets.clone();let owned_completion=cleanup.clone();
                        cleanup.video.store(false,Ordering::Release);
                        video_thread=Some(thread::Builder::new().name("signin-video".into()).spawn(move||{let _done=VideoDone(owned_completion);if let Err(error)=video(owned_scope,owned_packets){crate::signin_worker::trace(&format!("video thread ended with an error: {error}"));}})?);
                    }
                    if video_thread.as_ref().is_some_and(|thread|thread.is_finished()){crate::signin_worker::trace("peer loop: the video thread finished");return Err(rejected());}
                    // Bound each poll batch; queue overflow independently ends signaling.
                    for _ in 0..16 {let Some(event)=signaling.try_event()? else {break;};match event {
                        Event::Answer(sdp)=>{
                            if answered{return Err(rejected());}
                            checked(&scope,false,pc.set_remote_description(RTCSessionDescription::answer(sdp)?)).await?;
                            answered=true;
                            for candidate in remote.drain(..){checked(&scope,false,pc.add_ice_candidate(candidate)).await?;}
                        },
                        Event::Candidate(candidate)=>{
                            if candidate.candidate.is_empty(){continue;}
                            let candidate=RTCIceCandidateInit{candidate:candidate.candidate,sdp_mid:candidate.sdp_mid,sdp_mline_index:candidate.sdp_m_line_index,..Default::default()};
                            if answered {checked(&scope,false,pc.add_ice_candidate(candidate)).await?;}
                            else {if remote.len()>=16{return Err(rejected());}remote.push(candidate);}
                        },
                        other=>{crate::signin_worker::trace(&format!("peer loop: unexpected signaling event ({})",match other {Event::Ready(_)=>"ready",Event::PeerReady=>"peer-ready",_=>"other"}));return Err(rejected());},
                    }}
                },
                candidate=candidate_receiver.recv()=>{
                    let candidate=candidate.ok_or_else(rejected)?;
                    signaling.send(Command::Candidate(Candidate{candidate:candidate.candidate,sdp_mid:candidate.sdp_mid,sdp_m_line_index:candidate.sdp_mline_index}))?;
                },
                packet=receiver.recv()=>{
                    let packet=packet.ok_or_else(rejected)?;
                    if let Err(error)=scope.authorize(){crate::signin_worker::trace(&format!("peer loop: authority check before sending failed: {error}"));return Err(error);}
                    let parameters=checked(&scope,true,sender.get_parameters()).await?;
                    let payload=parameters.rtp_parameters.codecs.first().ok_or_else(rejected)?.payload_type;
                    // Bytes owns zeroizing storage, including while buffered in RTP.
                    let data=bytes::Bytes::from_owner(PacketBytes(packet.bytes));
                    checked(&scope,true,track.sample_writer(SSRC,payload).write_sample(&Sample{data,duration:INTERVAL,..Sample::new(Instant::now())})).await?;
                },
            }}}.await;
            scope.stop();
            receiver.close();while receiver.try_recv().is_ok(){}
            // Close transport before waiting for encoder/input cleanup. No
            // queued video may be sent during a potentially slow key release.
            let _=timeout(Duration::from_millis(250),pc.close()).await;
            if let Some(thread)=video_thread {
                unsafe {WaitForSingleObject(thread.as_raw_handle(),500);}
                if thread.is_finished(){let _=thread.join();}
                // A stuck codec remains in this scoped worker's kill-on-close job.
            }
            result
        }.await;
        scope.stop();
        // Also covers setup failures after the input lane was created.
        let _=timeout(Duration::from_millis(250),pc.close()).await;
        // Input cleanup is independent of network availability and may take 3s.
        if !matches!(timeout(Duration::from_millis(3700),input_task).await,Ok(Ok(_))) {
            cleanup.input.store(false,Ordering::Release);
        }
        cycle
    }.await;
    scope.stop();
    let _ = timeout(Duration::from_millis(500), pc.close()).await;
    result
}
// Bytes retains this owner rather than copying encoded pixels into untracked
// storage. The final Bytes clone dropping zeroizes its complete allocation.
struct PacketBytes(Zeroizing<Vec<u8>>);
impl AsRef<[u8]> for PacketBytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

async fn run(
    signaling: SignInSignaling,
    scope: Arc<SignInScope>,
    cleanup: Arc<Completion>,
) -> Result<(), HostError> {
    let _end = EndScope(scope.clone());
    let mut ready = None;
    let started = Instant::now();
    loop {
        scope.authorize_signaling()?;
        if started.elapsed() > Duration::from_secs(10) {
            crate::signin_worker::trace("signaling: the viewer was not ready within 10 seconds");
            return Err(rejected());
        }
        let event = match signaling.try_event() {
            Ok(event) => event,
            Err(error) => {
                crate::signin_worker::trace(&format!("signaling ended: {error}"));
                return Err(error);
            }
        };
        match event {
            Some(Event::Ready(config)) if ready.is_none() => {
                crate::signin_worker::trace("signaling: ready");
                ready = Some(config)
            }
            Some(Event::PeerReady) => {
                crate::signin_worker::trace("signaling: the viewer is ready");
                return peer(
                    &signaling,
                    scope.clone(),
                    ready.take().ok_or_else(rejected)?,
                    cleanup,
                )
                .await;
            }
            Some(_) => {
                crate::signin_worker::trace(
                    "signaling: unexpected event before the viewer was ready",
                );
                return Err(rejected());
            }
            None => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    }
}
pub(crate) struct SignInMedia {
    scope: Arc<SignInScope>,
    thread: Option<JoinHandle<()>>,
    cleanup: Arc<Completion>,
    joined: bool,
}
impl SignInMedia {
    pub(crate) fn start(
        signaling: SignInSignaling,
        scope: Arc<SignInScope>,
    ) -> Result<Self, HostError> {
        scope.authorize_signaling()?;
        let owned = scope.clone();
        let cleanup = Arc::new(Completion {
            input: AtomicBool::new(true),
            video: AtomicBool::new(true),
        });
        let owned_cleanup = cleanup.clone();
        let thread = thread::Builder::new()
            .name("signin-media".into())
            .spawn(move || {
                let _end = EndScope(owned.clone());
                if let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                {
                    match runtime.block_on(run(signaling, owned, owned_cleanup)) {
                        Ok(()) => crate::signin_worker::trace("media runner finished"),
                        Err(error) => crate::signin_worker::trace(&format!(
                            "media runner ended with an error: {error}"
                        )),
                    }
                    runtime.shutdown_timeout(Duration::from_millis(500));
                }
            })
            .map_err(|_| {
                scope.stop();
                rejected()
            })?;
        Ok(Self {
            scope,
            thread: Some(thread),
            cleanup,
            joined: false,
        })
    }
    pub(crate) fn ended(&self) -> bool {
        self.scope.authorize_signaling().is_err()
            || self
                .thread
                .as_ref()
                .is_none_or(|thread| thread.is_finished())
    }
    pub(crate) fn stop_and_cleanup(&mut self) -> bool {
        self.scope.stop();
        let Some(thread) = self.thread.take() else {
            return self.joined && self.cleanup.complete();
        };
        unsafe {
            WaitForSingleObject(thread.as_raw_handle(), 3500);
        }
        if !thread.is_finished() {
            return false;
        }
        self.joined = thread.join().is_ok();
        self.joined && self.cleanup.complete()
    }
    /// Poll without holding up private lifecycle replies or the Retry window.
    /// None means owned media teardown is still running, never confirmation.
    pub(crate) fn poll_cleanup(&mut self) -> Option<bool> {
        self.scope.stop();
        if self
            .thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished())
        {
            return None;
        }
        Some(self.stop_and_cleanup())
    }
}
impl Drop for SignInMedia {
    fn drop(&mut self) {
        let _ = self.stop_and_cleanup();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    #[test]
    fn pending_media_cleanup_can_be_polled_without_blocking_or_reauthorizing() {
        let scope = SignInScope::new(
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
            1,
            crate::signin_scope::tick() + 10_000 * crate::signin_scope::TICKS_PER_MILLISECOND,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        let completion = Arc::new(Completion {
            input: AtomicBool::new(true),
            video: AtomicBool::new(true),
        });
        let (release, wait) = std::sync::mpsc::channel();
        let thread = thread::spawn(move || {
            wait.recv().unwrap();
        });
        let mut media = SignInMedia {
            scope: scope.clone(),
            thread: Some(thread),
            cleanup: completion,
            joined: false,
        };
        assert_eq!(media.poll_cleanup(), None);
        assert!(scope.expired());
        release.send(()).unwrap();
        let until = Instant::now() + Duration::from_secs(2);
        while media
            .thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished())
        {
            assert!(Instant::now() < until);
            thread::yield_now();
        }
        assert_eq!(media.poll_cleanup(), Some(true));
        assert_eq!(media.poll_cleanup(), Some(true));
        assert!(scope.expired());
    }
    #[test]
    fn a_panicking_video_thread_cannot_confirm_cleanup() {
        let completion = Arc::new(Completion {
            input: AtomicBool::new(true),
            video: AtomicBool::new(false),
        });
        let owned = completion.clone();
        let thread = thread::spawn(move || {
            let _done = VideoDone(owned);
            panic!("synthetic codec failure");
        });
        assert!(thread.join().is_err());
        assert!(!completion.complete());
    }
    struct NoDesktop;
    #[async_trait::async_trait]
    impl PeerConnectionEventHandler for NoDesktop {}
    fn ready_fixture() -> Ready {
        serde_json::from_value(serde_json::json!({
            "scope":"windows:sign-in","leaseId":uuid::Uuid::new_v4().to_string(),"instanceId":uuid::Uuid::new_v4().to_string(),
            "consoleSessionId":1,"workerPublicKey":"fixture","iceServers":[],"iceTransportPolicy":"all",
            "files":false,"clipboard":false,"audio":false,"recording":false,"automation":false
        })).unwrap()
    }
    #[tokio::test]
    async fn real_peer_offer_is_send_only_h264_with_one_bounded_ordered_input_lane() {
        // Real RTC initialization/SDP on a loopback socket, with no scope,
        // capture/input adapter, remote server, STUN or privileged identity.
        timeout(Duration::from_secs(5), async {
            let ready = ready_fixture();
            let (codec, builder) = configured_peer(&ready, Arc::new(NoDesktop)).unwrap();
            let pc = builder
                .with_udp_addrs(vec!["127.0.0.1:0".to_owned()])
                .build()
                .await
                .unwrap();
            let track = video_track(codec.rtp_codec).unwrap();
            pc.add_track(track as Arc<dyn TrackLocal>).await.unwrap();
            for transceiver in pc.get_transceivers().await {
                transceiver
                    .set_direction(RTCRtpTransceiverDirection::Sendonly)
                    .await
                    .unwrap();
            }
            let channel = pc
                .create_data_channel(
                    INPUT_CHANNEL,
                    Some(RTCDataChannelInit {
                        ordered: true,
                        ..Default::default()
                    }),
                )
                .await
                .unwrap();
            assert_eq!(channel.label().await.unwrap(), INPUT_CHANNEL);
            assert!(channel.ordered().await.unwrap());
            let offer = pc.create_offer(None).await.unwrap();
            assert!(offer.sdp.contains("m=video "));
            assert!(offer.sdp.contains("a=sendonly"));
            assert!(offer.sdp.contains("H264/90000"));
            assert!(offer.sdp.contains("m=application "));
            assert!(offer.sdp.contains("a=max-message-size:4096"));
            assert!(!offer.sdp.contains("m=audio "));
            assert!(!offer.sdp.contains("VP8/"));
            pc.close().await.unwrap();
        })
        .await
        .unwrap();
    }
    struct Loopback {
        candidates: mpsc::Sender<RTCIceCandidateInit>,
        channels: mpsc::Sender<Arc<dyn DataChannel>>,
    }
    #[async_trait::async_trait]
    impl PeerConnectionEventHandler for Loopback {
        async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
            if let Some(candidate) = local_candidate(event).unwrap() {
                self.candidates.try_send(candidate).unwrap();
            }
        }
        async fn on_data_channel(&self, channel: Arc<dyn DataChannel>) {
            self.channels.try_send(channel).unwrap();
        }
    }
    #[tokio::test]
    async fn real_loopback_peers_exchange_scoped_input_bytes_without_os_input() {
        timeout(Duration::from_secs(10),async {
            let (host_candidates,mut from_host)=mpsc::channel(16);
            let (viewer_candidates,mut from_viewer)=mpsc::channel(16);
            let (channels,mut opened)=mpsc::channel(2);
            let ready=ready_fixture();
            let (codec,host)=configured_peer(&ready,Arc::new(Loopback{candidates:host_candidates,channels:channels.clone()})).unwrap();
            let (_,viewer)=configured_peer(&ready,Arc::new(Loopback{candidates:viewer_candidates,channels})).unwrap();
            let host=Arc::new(host.with_udp_addrs(vec!["127.0.0.1:0".to_owned()]).build().await.unwrap());
            let viewer=Arc::new(viewer.with_udp_addrs(vec!["127.0.0.1:0".to_owned()]).build().await.unwrap());
            host.add_track(video_track(codec.rtp_codec).unwrap() as Arc<dyn TrackLocal>).await.unwrap();
            for transceiver in host.get_transceivers().await {transceiver.set_direction(RTCRtpTransceiverDirection::Sendonly).await.unwrap();}
            let channel=host.create_data_channel(INPUT_CHANNEL,Some(RTCDataChannelInit{ordered:true,..Default::default()})).await.unwrap();
            let offer=host.create_offer(None).await.unwrap();
            host.set_local_description(offer.clone()).await.unwrap();
            viewer.set_remote_description(offer).await.unwrap();
            let answer=viewer.create_answer(None).await.unwrap();
            viewer.set_local_description(answer.clone()).await.unwrap();
            host.set_remote_description(answer).await.unwrap();
            let destination=viewer.clone();
            let to_viewer=tokio::spawn(async move {while let Some(candidate)=from_host.recv().await {destination.add_ice_candidate(candidate).await.unwrap();}});
            let destination=host.clone();
            let to_host=tokio::spawn(async move {while let Some(candidate)=from_viewer.recv().await {destination.add_ice_candidate(candidate).await.unwrap();}});
            let remote=opened.recv().await.unwrap();
            assert_eq!(remote.label().await.unwrap(),INPUT_CHANNEL);
            assert!(remote.ordered().await.unwrap());
            assert!(matches!(channel.poll().await,Some(DataChannelEvent::OnOpen)));
            assert!(matches!(remote.poll().await,Some(DataChannelEvent::OnOpen)));
            let envelope=serde_json::json!({"version":1,"scope":"windows:sign-in","leaseId":"synthetic-lease","instanceId":"synthetic-worker","consoleSessionId":1,"sequence":1,"input":{"type":"keep_alive"}}).to_string();
            remote.send_text(&envelope).await.unwrap();
            match channel.poll().await {
                Some(DataChannelEvent::OnMessage(message))=>{assert!(message.is_string);assert_eq!(message.data.as_ref(),envelope.as_bytes());},
                _=>panic!("missing loopback input envelope"),
            }
            // Neither test peer owns any native scope or input/capture adapter.
            host.close().await.unwrap();viewer.close().await.unwrap();
            to_viewer.abort();to_host.abort();
        }).await.expect("loopback RTC exchange timed out");
    }
    struct Dropped(Arc<AtomicBool>);
    impl Drop for Dropped {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }
    #[tokio::test]
    async fn stopped_authority_cancels_a_blocked_write_and_discards_its_owner() {
        let stopped = Arc::new(AtomicBool::new(false));
        let discarded = Arc::new(AtomicBool::new(false));
        let check_stop = stopped.clone();
        let on_drop = discarded.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            checked_by(
                move || {
                    if check_stop.load(Ordering::Acquire) {
                        Err(rejected())
                    } else {
                        Ok(())
                    }
                },
                async move {
                    let _owner = Dropped(on_drop);
                    let _ = started.send(());
                    std::future::pending::<Result<(), io::Error>>().await
                },
            )
            .await
        });
        ready.await.unwrap();
        stopped.store(true, Ordering::Release);
        assert!(timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        assert!(discarded.load(Ordering::Acquire));
    }
    #[tokio::test]
    async fn revocation_during_a_completed_operation_cannot_return_its_result() {
        let stopped = Arc::new(AtomicBool::new(false));
        let check_stop = stopped.clone();
        let result = checked_by(
            move || {
                if check_stop.load(Ordering::Acquire) {
                    Err(rejected())
                } else {
                    Ok(())
                }
            },
            async move {
                stopped.store(true, Ordering::Release);
                Ok::<_, io::Error>(vec![42u8; 16])
            },
        )
        .await;
        assert!(result.is_err());
    }
    #[test]
    fn a_lease_without_a_connected_peer_cannot_initialize_video_or_the_encoder() {
        let scope = SignInScope::new(
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
            1,
            crate::signin_scope::tick() + 10_000 * crate::signin_scope::TICKS_PER_MILLISECOND,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        let (packets, mut receiver) = mpsc::channel(2);
        assert!(video(scope.clone(), packets).is_err());
        assert!(scope.expired());
        assert!(receiver.try_recv().is_err());
    }
}
