//! Bounded synthetic-video acceptance path. Never reads the desktop.
use crate::encoder::Encoder;
use futures_util::{SinkExt, StreamExt};
use rtc::{
    interceptor::Registry,
    media::Sample,
    media_stream::MediaStreamTrack,
    peer_connection::configuration::{
        interceptor_registry::register_default_interceptors,
        media_engine::{MediaEngine, MIME_TYPE_H264},
    },
    rtp_transceiver::rtp_sender::{
        RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters,
        RtpCodecKind,
    },
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, Read},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    sync::{mpsc, Notify},
    time::timeout,
};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig, Message},
};
use webrtc::{
    media_stream::track_local::{static_sample::TrackLocalStaticSample, TrackLocal},
    peer_connection::{
        PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
        RTCIceCandidateInit, RTCIceGatheringState, RTCIceServer, RTCPeerConnectionState,
        RTCSessionDescription,
    },
    runtime::TokioRuntime,
};

type Error = Box<dyn std::error::Error + Send + Sync>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    id: String,
    token: String,
    server: String,
    source: String,
    controller: String,
    expires_at_millis: u64,
    ice_servers: Vec<IceServer>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IceServer {
    urls: Vec<String>,
}
struct Handler {
    gathered: Arc<Notify>,
    connected: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
}
#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            self.gathered.notify_one();
        }
    }
    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        match state {
            RTCPeerConnectionState::Connected => {
                self.connected.store(true, Ordering::Release);
            }
            RTCPeerConnectionState::Failed
            | RTCPeerConnectionState::Disconnected
            | RTCPeerConnectionState::Closed => {
                self.active.store(false, Ordering::Release);
            }
            _ => {}
        }
    }
}
struct StopOnDrop(Arc<AtomicBool>);
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
fn now_millis() -> Result<u64, Error> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

pub fn synthetic() -> Result<(), Error> {
    let mut input = String::new();
    io::stdin().take(8193).read_to_string(&mut input)?;
    if input.len() > 8192 {
        return Err("Grant exceeds size limit".into());
    }
    let grant: Grant = serde_json::from_str(&input)?;
    if grant.source != "synthetic" || grant.controller.len() > 254 {
        return Err("This command accepts synthetic video grants only".into());
    }
    let now = now_millis()?;
    if grant.expires_at_millis <= now || grant.expires_at_millis - now > 120_000 {
        return Err("Expired or excessive grant".into());
    }
    if grant.id.len() != 36
        || !grant.id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        || grant.token.len() != 43
        || !grant
            .token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid grant".into());
    }
    let origin = url::Url::parse(&grant.server)?;
    let local = matches!(origin.host_str(), Some("127.0.0.1") | Some("localhost"));
    if (origin.scheme() != "https" && !(local && origin.scheme() == "http"))
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err("Invalid server origin".into());
    }
    if grant.ice_servers.len() > 2
        || grant
            .ice_servers
            .iter()
            .any(|s| s.urls.len() != 1 || !s.urls[0].starts_with("stun:") || s.urls[0].len() > 256)
    {
        return Err("Invalid ICE servers".into());
    }
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?
        .block_on(stream(grant))
}

async fn stream(grant: Grant) -> Result<(), Error> {
    println!(
        "SYNTHETIC VIDEO TEST: no screen capture, audio, recording or input. Maximum two minutes."
    );
    let mut url = url::Url::parse(&grant.server)?;
    url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" })
        .map_err(|_| "Invalid signaling URL")?;
    url.set_path(&format!("/api/sessions/{}/signal", grant.id));
    url.set_query(Some("role=machine"));
    let mut request = url.as_str().into_client_request()?;
    request
        .headers_mut()
        .insert("Authorization", format!("Bearer {}", grant.token).parse()?);
    let limits = WebSocketConfig::default()
        .max_message_size(Some(65536))
        .max_frame_size(Some(65536));
    let (mut socket, _) = timeout(
        Duration::from_secs(10),
        connect_async_with_config(request, Some(limits), true),
    )
    .await??;
    socket
        .send(Message::Text(
            json!({"type":"consent","accepted":true}).to_string().into(),
        ))
        .await?;
    let active = Arc::new(AtomicBool::new(true));
    let _stop = StopOnDrop(active.clone());
    let connected = Arc::new(AtomicBool::new(false));
    let gathered = Arc::new(Notify::new());
    let lease = Arc::new(AtomicU64::new(0));
    let epoch = Instant::now();
    let lifetime = Duration::from_millis(grant.expires_at_millis.saturating_sub(now_millis()?));
    let deadline = epoch + lifetime;
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
        ..Default::default()
    };
    engine.register_codec(codec.clone(), RtpCodecKind::Video)?;
    let registry = register_default_interceptors(Registry::new(), &mut engine)?;
    let config = RTCConfigurationBuilder::new()
        .with_ice_servers(
            grant
                .ice_servers
                .into_iter()
                .map(|s| RTCIceServer {
                    urls: s.urls,
                    ..Default::default()
                })
                .collect(),
        )
        .build();
    let pc = PeerConnectionBuilder::new()
        .with_configuration(config)
        .with_media_engine(engine)
        .with_interceptor_registry(registry)
        .with_runtime(Arc::new(TokioRuntime))
        .with_handler(Arc::new(Handler {
            gathered: gathered.clone(),
            connected: connected.clone(),
            active: active.clone(),
        }))
        .with_udp_addrs(vec!["0.0.0.0:0".to_owned()])
        .build()
        .await?;
    let track = Arc::new(TrackLocalStaticSample::new(
        Instant::now(),
        MediaStreamTrack::new(
            "beacon-test-stream".into(),
            "beacon-test-video".into(),
            "Synthetic video — no desktop".into(),
            RtpCodecKind::Video,
            vec![RTCRtpEncodingParameters {
                rtp_coding_parameters: RTCRtpCodingParameters {
                    ssrc: Some(7_230_001),
                    ..Default::default()
                },
                codec: codec.rtp_codec,
                ..Default::default()
            }],
        ),
    )?);
    let sender = pc.add_track(track.clone() as Arc<dyn TrackLocal>).await?;
    pc.set_local_description(pc.create_offer(None).await?)
        .await?;
    timeout(Duration::from_secs(10), gathered.notified()).await?;
    let description = pc
        .local_description()
        .await
        .ok_or("Missing local description")?;
    socket
        .send(Message::Text(
            json!({"type":"offer","sdp":description.sdp})
                .to_string()
                .into(),
        ))
        .await?;
    let (packets, mut receiver) = mpsc::channel::<crate::encoder::EncodedFrame>(2);
    let worker_active = active.clone();
    let worker_connected = connected.clone();
    let worker_lease = lease.clone();
    let worker = tokio::task::spawn_blocking(move || -> Result<(), Error> {
        let mut encoder = Encoder::new(1280, 720, 30, 2_500_000)?;
        let mut nv12 = vec![128; 1280 * 720 * 3 / 2];
        let mut index = 0;
        while worker_active.load(Ordering::Acquire) && Instant::now() < deadline {
            let last = worker_lease.load(Ordering::Acquire);
            let elapsed = epoch.elapsed().as_millis() as u64;
            if last != 0 && elapsed.saturating_sub(last) > 3000 {
                break;
            }
            if !worker_connected.load(Ordering::Acquire) || last == 0 {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            let started = Instant::now();
            for (offset, pixel) in nv12[..1280 * 720].iter_mut().enumerate() {
                *pixel = 16 + ((offset / 1280 + index as usize * 4) % 220) as u8;
            }
            for packet in encoder.encode(&nv12, index)? {
                if packets.try_send(packet).is_err() {
                    worker_active.store(false, Ordering::Release);
                    return Err("Media consumer stalled".into());
                }
            }
            index += 1;
            if let Some(delay) = Duration::from_millis(33).checked_sub(started.elapsed()) {
                std::thread::sleep(delay);
            }
        }
        worker_active.store(false, Ordering::Release);
        Ok(())
    });
    let result:Result<(),Error> = async {
        let mut tick=tokio::time::interval(Duration::from_millis(100));
        let mut answered=false;
        loop {
            tokio::select! {
                _=tick.tick()=>{if !active.load(Ordering::Acquire) || Instant::now()>=deadline {break;}}
                packet=receiver.recv()=>{
                    let Some(packet)=packet else {break;};
                    if !answered {return Err("Media arrived before answer".into());}
                    let payload=sender.get_parameters().await?.rtp_parameters.codecs.first().ok_or("No negotiated codec")?.payload_type;
                    timeout(Duration::from_millis(500),track.sample_writer(7_230_001,payload).write_sample(&Sample{data:bytes::Bytes::from(packet.bytes),duration:Duration::from_secs_f64(1.0/30.0),..Sample::new(Instant::now())})).await??;
                }
                message=socket.next()=>{
                    let text=match message {Some(Ok(Message::Text(text)))=>text,Some(Ok(Message::Ping(_) | Message::Pong(_)))=>continue,_=>break};
                    if text.len()>65536 {return Err("Oversized signaling".into());}
                    let body:Value=serde_json::from_str(&text)?;
                    match body["type"].as_str() {
                        Some("answer")=>{if answered{return Err("Repeated answer".into());} let sdp=body["sdp"].as_str().filter(|s|s.len()<=32768).ok_or("Invalid answer")?;pc.set_remote_description(RTCSessionDescription::answer(sdp.into())?).await?;answered=true;}
                        Some("candidate")=>{let candidate=body["candidate"].as_str().filter(|s|s.len()<=2048).ok_or("Invalid candidate")?;if !candidate.is_empty(){pc.add_ice_candidate(RTCIceCandidateInit{candidate:candidate.into(),sdp_mid:body["sdpMid"].as_str().map(String::from),sdp_mline_index:body["sdpMLineIndex"].as_u64().map(|v|v as u16),..Default::default()}).await?;}}
                        Some("lease")=>{if body["expiresAtMillis"].as_u64()!=Some(grant.expires_at_millis) || body["maxAgeMs"].as_u64()!=Some(3000) {return Err("Invalid lease".into());} lease.store((epoch.elapsed().as_millis() as u64).max(1),Ordering::Release);}
                        Some("ended")=>break,
                        Some("joined")=>{},
                        _=>return Err("Unexpected signaling".into())
                    }
                }
            }
        } Ok(())
    }.await;
    active.store(false, Ordering::Release);
    let _ = timeout(Duration::from_secs(2), pc.close()).await;
    let _ = socket.close(None).await;
    timeout(Duration::from_secs(3), worker).await???;
    println!("Synthetic video stopped. Nothing recorded or captured.");
    result
}
