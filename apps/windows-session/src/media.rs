//! Bounded view-only media; desktop requires local consent and visible Stop.
use crate::encoder::Encoder;
use crate::renewal::{remaining, Renewals, MAX_AGE_MS};
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
    io::{self, BufRead, BufReader, Read},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{sync::mpsc, time::timeout};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig, Message},
};
use webrtc::{
    media_stream::track_local::{static_sample::TrackLocalStaticSample, TrackLocal},
    peer_connection::{
        PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
        RTCIceCandidateInit, RTCIceConnectionState, RTCIceGatheringState, RTCIceServer,
        RTCIceTransportPolicy, RTCPeerConnectionIceErrorEvent, RTCPeerConnectionIceEvent,
        RTCPeerConnectionState, RTCSessionDescription,
    },
    runtime::TokioRuntime,
};

type Error = Box<dyn std::error::Error + Send + Sync>;
// Peers replaced within one session; matches the server (ADR 0021).
const MAX_GENERATIONS: u64 = 1024;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    id: String,
    token: String,
    server: String,
    source: String,
    #[serde(default = "view_capability")]
    capability: String,
    controller: String,
    expires_at_millis: u64,
    #[serde(default)]
    approval_expires_at_millis: Option<u64>,
    // "policy" when the server relied on the computer's trusted-access policy (ADR 0021).
    #[serde(default)]
    approval: Option<String>,
    // Added by the local agent only when this computer's own setting also allows trusted access.
    #[serde(default)]
    local_trusted: bool,
    // The display the viewer chose, from the list this computer reported. None is the primary.
    #[serde(default)]
    display_id: Option<String>,
    // How long the server waits for the viewer to reconnect; capture stays off meanwhile.
    #[serde(default)]
    reconnect_seconds: Option<u64>,
    ice_servers: Vec<IceServer>,
    ice_transport_policy: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct IceServer {
    urls: Vec<String>,
    username: Option<String>,
    credential: Option<String>,
}
fn view_capability() -> String {
    "desktop:view".into()
}
// A relay username is "<expiry seconds>:beacon-remote:<session id>" with a short future expiry.
fn valid_turn_username(username: &str, id: &str, now_secs: u64) -> bool {
    let Some((expiry, rest)) = username.split_once(':') else {
        return false;
    };
    let Ok(expiry) = expiry.parse::<u64>() else {
        return false;
    };
    rest == format!("beacon-remote:{id}") && expiry + 120 > now_secs && expiry <= now_secs + 2100
}
fn validate_ice(grant: &Grant) -> Result<(), Error> {
    validate_ice_servers(&grant.id, &grant.ice_transport_policy, &grant.ice_servers)
}
fn validate_ice_servers(id: &str, policy: &str, servers: &[IceServer]) -> Result<(), Error> {
    if !matches!(policy, "all" | "relay") || servers.is_empty() || servers.len() > 2 {
        return Err("Invalid ICE policy or servers".into());
    }
    let now_secs = now_millis()? / 1000;
    let mut has_relay = false;
    for server in servers {
        if server.urls.is_empty()
            || server.urls.len() > 3
            || server.urls.iter().any(|url| url.len() > 256)
        {
            return Err("Invalid ICE URLs".into());
        }
        let stun = server.urls.iter().all(|url| url.starts_with("stun:"));
        let turn = server
            .urls
            .iter()
            .all(|url| url.starts_with("turn:") || url.starts_with("turns:"));
        if stun {
            if server.username.is_some() || server.credential.is_some() {
                return Err("STUN must not contain credentials".into());
            }
        } else if turn {
            let credential = server
                .credential
                .as_deref()
                .ok_or("Missing TURN credential")?;
            if !server
                .username
                .as_deref()
                .is_some_and(|name| valid_turn_username(name, id, now_secs))
                || credential.len() != 28
                || !credential.ends_with('=')
                || !credential[..27]
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
            {
                return Err("Invalid session-bound TURN credential".into());
            }
            has_relay = true;
        } else {
            return Err("Invalid or mixed ICE schemes".into());
        }
        let urls = RTCIceServer {
            urls: server.urls.clone(),
            username: server.username.clone().unwrap_or_default(),
            credential: server.credential.clone().unwrap_or_default(),
        }
        .urls()
        .map_err(|_| "Invalid ICE URL syntax")?;
        if turn
            && urls
                .iter()
                .any(|url| url.is_secure() || url.proto.to_string() != "udp")
        {
            return Err("Native TURN requires UDP; TCP/TLS is unsupported".into());
        }
    }
    if policy == "relay" && !has_relay {
        return Err("Relay-only policy requires TURN".into());
    }
    Ok(())
}
struct Handler {
    candidates: mpsc::Sender<RTCIceCandidateInit>,
    connected: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    disconnected: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
    started: Instant,
    generation: u64,
}
#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_candidate_error(&self, event: RTCPeerConnectionIceErrorEvent) {
        println!(
            "Native ICE error: generation {}, code {}, {} ms.",
            self.generation,
            event.error_code,
            self.started.elapsed().as_millis()
        );
    }
    async fn on_ice_connection_state_change(&self, state: RTCIceConnectionState) {
        println!(
            "Native ICE state: generation {}, {state}, {} ms.",
            self.generation,
            self.started.elapsed().as_millis()
        );
    }
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        println!(
            "Native ICE gathering: generation {}, {state}, {} ms.",
            self.generation,
            self.started.elapsed().as_millis()
        );
    }
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        match event.candidate.to_json() {
            Ok(candidate) if candidate.candidate.is_empty() => {}
            Ok(mut candidate) => {
                // The prototype has one video m-line; the SDK emits an empty mid.
                candidate.sdp_mid = None;
                candidate.sdp_mline_index = Some(0);
                if self.candidates.try_send(candidate).is_err() {
                    self.active.store(false, Ordering::Release);
                }
            }
            Err(_) => {
                self.active.store(false, Ordering::Release);
            }
        }
    }
    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        // State names are safe diagnostics; never log SDP, candidates or grants.
        println!(
            "Native peer connection state: generation {}, {state}, {} ms.",
            self.generation,
            self.started.elapsed().as_millis()
        );
        match state {
            RTCPeerConnectionState::Connected => {
                self.failed.store(false, Ordering::Release);
                self.disconnected.store(false, Ordering::Release);
                self.connected.store(true, Ordering::Release);
            }
            RTCPeerConnectionState::Disconnected => {
                self.connected.store(false, Ordering::Release);
                self.disconnected.store(true, Ordering::Release);
            }
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed => {
                self.failed.store(true, Ordering::Release);
                // The old peer remains unable to capture. Give the original
                // viewer a short chance to detach and request a fresh peer.
                self.connected.store(false, Ordering::Release);
                self.disconnected.store(true, Ordering::Release);
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

// Keep reading signaling while local approval is open. Never offer capture from
// a completed dialog after cancellation, expiry or an invalid join handshake.
async fn consent_while_signaling<S, E, F>(
    socket: &mut S,
    decision: F,
    deadline: Instant,
    control: bool,
) -> Result<bool, Error>
where
    S: futures_util::Stream<Item = Result<Message, E>> + Unpin,
    E: std::error::Error + Send + Sync + 'static,
    F: std::future::Future<Output = Result<bool, Error>>,
{
    tokio::pin!(decision);
    let expiry = tokio::time::sleep_until(deadline.into());
    tokio::pin!(expiry);
    let mut joined = false;
    let mut approved = false;
    loop {
        tokio::select! {
            // Already observable cancellation/expiry wins over a late click.
            biased;
            _ = &mut expiry => return Ok(false),
            message = socket.next() => {
                match message {
                    Some(Ok(Message::Text(text))) if text.len() <= 65536 => {
                        let body: Value = serde_json::from_str(&text)?;
                        match body["type"].as_str() {
                            Some("joined") if !joined && body["role"] == "machine" && body["source"] == "desktop" && (!control || body["capability"] == "desktop:control") => joined = true,
                            Some("ended") => return Ok(false),
                            _ => return Err("Unexpected signaling during local consent".into()),
                        }
                    }
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {},
                    Some(Err(error)) => return Err(error.into()),
                    None | Some(Ok(Message::Close(_))) => return Ok(false),
                    _ => return Err("Invalid signaling during local consent".into()),
                }
            }
            accepted = &mut decision, if !approved => {
                if !accepted? { return Ok(false); }
                approved = true;
            }
        }
        if joined && approved && Instant::now() < deadline {
            return Ok(true);
        }
    }
}

pub fn run() -> Result<(), Error> {
    let mut input = String::new();
    io::stdin().take(8193).read_to_string(&mut input)?;
    run_grant(input, Arc::new(AtomicBool::new(true)))
}

// The host owns an anonymous child stdin pipe. No discoverable local endpoint,
// browser message or remote peer can use it to grant capture/input authority.
// Stop or EOF only revoke; the initial server grant and local consent still apply.
pub fn run_host() -> Result<(), Error> {
    let mut reader = BufReader::new(io::stdin());
    let mut input = String::new();
    Read::take(&mut reader, 8193).read_line(&mut input)?;
    if !input.ends_with('\n') {
        return Err("Missing framed host grant".into());
    }
    let active = Arc::new(AtomicBool::new(true));
    let stopping = active.clone();
    std::thread::spawn(move || {
        let mut command = [0_u8; 5];
        // Any Stop, malformed control or pipe EOF fails closed.
        let _ = reader.read_exact(&mut command);
        stopping.store(false, Ordering::Release);
    });
    run_grant(input, active)
}

fn run_grant(input: String, parent_active: Arc<AtomicBool>) -> Result<(), Error> {
    if input.len() > 8192 {
        return Err("Grant exceeds size limit".into());
    }
    let grant: Grant = serde_json::from_str(&input)?;
    if !matches!(grant.source.as_str(), "synthetic" | "desktop")
        || grant.controller.is_empty()
        || grant.controller.len() > 254
    {
        return Err("Invalid view source or controller".into());
    }
    if !matches!(
        grant.capability.as_str(),
        "desktop:view" | "desktop:control"
    ) || (grant.capability == "desktop:control" && grant.source != "desktop")
    {
        return Err("Invalid capability for this source".into());
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
    let now = now_millis()?;
    // expiresAtMillis 0 means no fixed expiry: the lease, not a timer, ends the session.
    let unlimited = grant.expires_at_millis == 0;
    let approval_expiry = if unlimited {
        grant
            .approval_expires_at_millis
            .ok_or("Missing approval deadline")?
    } else {
        grant.expires_at_millis
    };
    if approval_expiry <= now || approval_expiry - now > 120_000 {
        return Err("Expired or excessive grant".into());
    }
    let deadline = Instant::now() + Duration::from_millis(approval_expiry - now);
    if (origin.scheme() != "https" && !(local && origin.scheme() == "http"))
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err("Invalid server origin".into());
    }
    validate_ice(&grant)?;
    if grant.source == "desktop" {
        crate::capture::dpi_awareness()?;
    }
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?
        .block_on(stream(grant, deadline, parent_active))
}

async fn stream(
    grant: Grant,
    deadline: Instant,
    parent_active: Arc<AtomicBool>,
) -> Result<(), Error> {
    let desktop = grant.source == "desktop";
    let control = grant.capability == "desktop:control";
    // The absolute grant budget includes connection setup and the person's
    // response. Wall-clock changes cannot extend this monotonic deadline.
    if !parent_active.load(Ordering::Acquire)
        || Instant::now() >= deadline
        || (grant.expires_at_millis != 0 && now_millis()? >= grant.expires_at_millis)
    {
        return Err("View grant expired before connection".into());
    }
    println!(
        "{}",
        if control {
            "DESKTOP CONTROL REQUEST: explicit local mouse/keyboard approval required."
        } else if desktop {
            "DESKTOP VIEW REQUEST: local consent required. No audio, recording or input."
        } else {
            "SYNTHETIC VIDEO TEST: no screen capture, audio, recording or input."
        }
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
    // The server said "policy" and this computer's own setting agrees. Sharing stays visible
    // through the Stop window below, and Stop, sign-out or revocation still end it.
    let mut control_allowed = control;
    let by_policy = desktop && grant.approval.as_deref() == Some("policy") && grant.local_trusted;
    if by_policy {
        println!(
            "TRUSTED ACCESS: {} connected under this computer's trusted-access setting.",
            grant.controller
        );
    }
    if desktop && !by_policy {
        let unlimited = grant.expires_at_millis == 0;
        let controller = grant.controller.clone();
        let pending = Arc::new(AtomicBool::new(true));
        let _cancel_prompt = StopOnDrop(pending.clone());
        let dialog_pending = pending.clone();
        let display_label = crate::capture::display_label(grant.display_id.as_deref());
        let session_label = format!(
            "S-{}",
            grant.id.chars().take(4).collect::<String>().to_uppercase()
        );
        let chosen_control = Arc::new(AtomicBool::new(false));
        let reported_control = chosen_control.clone();
        let mut dialog = tokio::task::spawn_blocking(move || {
            let decision = crate::consent::request_access(
                &controller,
                dialog_pending,
                deadline,
                control,
                unlimited,
                &display_label,
                &session_label,
            )?;
            reported_control.store(
                decision == crate::consent::Decision::Control,
                Ordering::Release,
            );
            Ok::<_, Error>(decision != crate::consent::Decision::Declined)
        });
        let accepted = tokio::select! {
            accepted = consent_while_signaling(&mut socket, async { (&mut dialog).await? }, deadline, control) => accepted,
            _ = async {
                while parent_active.load(Ordering::Acquire) { tokio::time::sleep(Duration::from_millis(50)).await; }
            } => Ok(false),
        };
        pending.store(false, Ordering::Release);
        if !dialog.is_finished() {
            // A cancelled prompt observes its flag in the native timer. Join it
            // before returning so no pending approval window is left behind.
            timeout(Duration::from_secs(3), &mut dialog).await???;
        }
        let accepted = accepted?;
        if !accepted {
            // The peer may already be closed; denial must never become media or
            // fail to close the native prompt because reporting failed.
            let _ = timeout(
                Duration::from_millis(500),
                socket.send(Message::Text(
                    json!({"type":"consent","accepted":false})
                        .to_string()
                        .into(),
                )),
            )
            .await;
            println!("Desktop request declined, cancelled or expired; nothing captured.");
            return Ok(());
        }
        if Instant::now() >= deadline
            || (grant.expires_at_millis != 0 && now_millis()? >= grant.expires_at_millis)
        {
            return Err("View grant expired during consent".into());
        }
        // The person may allow viewing without the control that was asked for.
        control_allowed = chosen_control.load(Ordering::Acquire);
    }
    let deadline = (grant.expires_at_millis != 0).then_some(deadline);
    let active = parent_active;
    let connected = Arc::new(AtomicBool::new(false));
    let _stop = StopOnDrop(active.clone());
    // Refuse media if a visible local Stop control cannot be created.
    let _indicator = crate::indicator::Indicator::start_access(
        active.clone(),
        connected.clone(),
        desktop,
        grant.controller.clone(),
        deadline,
        control_allowed,
        format!(
            "S-{}",
            grant.id.chars().take(4).collect::<String>().to_uppercase()
        ),
    )?;
    timeout(
        Duration::from_millis(500),
        socket.send(Message::Text(
            if control && !control_allowed {
                json!({"type":"consent","accepted":true,"resumable":true,"control":false})
            } else {
                json!({"type":"consent","accepted":true,"resumable":true})
            }
            .to_string()
            .into(),
        )),
    )
    .await??;
    let mut authorization = MediaAuthorization {
        control_allowed,
        epoch: Instant::now(),
        lease: Arc::new(AtomicU64::new(0)),
        ice: Arc::new(std::sync::Mutex::new(grant.ice_servers.clone())),
    };
    let (mut socket, signaling) = SignalSocket::start(
        socket,
        grant.expires_at_millis,
        deadline,
        active.clone(),
        authorization.epoch,
        authorization.lease.clone(),
        (
            grant.id.clone(),
            grant.ice_transport_policy.clone(),
            authorization.ice.clone(),
        ),
    );
    let mut generation = 0;
    loop {
        if !media_cycle(
            &mut socket,
            &grant,
            deadline,
            active.clone(),
            connected.clone(),
            &mut authorization,
            generation,
        )
        .await?
        {
            break;
        }
        if !wait_for_viewer(
            &mut socket,
            &grant,
            deadline,
            active.clone(),
            &mut authorization,
            generation + 1,
        )
        .await?
        {
            break;
        }
        generation += 1;
    }
    active.store(false, Ordering::Release);
    let _ = timeout(Duration::from_millis(500), socket.close(None)).await;
    let _ = timeout(Duration::from_secs(1), signaling).await;
    println!("Viewing session ended.");
    Ok(())
}

type RawSignalSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
struct MediaAuthorization {
    epoch: Instant,
    lease: Arc<AtomicU64>,
    // Current ICE servers. The server re-issues short relay credentials inside lease replies.
    ice: Arc<std::sync::Mutex<Vec<IceServer>>>,
    // Whether the person at the computer allowed the control that was asked for.
    control_allowed: bool,
}

// Renewal must not wait behind peer setup, encoder creation or peer cleanup.
// Only this task owns the WebSocket and challenge sequence for the approval.
struct SignalSocket {
    incoming: mpsc::Receiver<Result<Message, Error>>,
    outgoing: mpsc::Sender<Message>,
    viewer_generation: Arc<AtomicU64>,
}
impl SignalSocket {
    fn start(
        mut raw: RawSignalSocket,
        expires_at: u64,
        deadline: Option<Instant>,
        active: Arc<AtomicBool>,
        epoch: Instant,
        lease: Arc<AtomicU64>,
        ice: (String, String, Arc<std::sync::Mutex<Vec<IceServer>>>),
    ) -> (Self, tokio::task::JoinHandle<()>) {
        let (incoming, receiver) = mpsc::channel(32);
        let (outgoing, mut sender) = mpsc::channel(32);
        let viewer_generation = Arc::new(AtomicU64::new(0));
        let viewer = viewer_generation.clone();
        let task = tokio::spawn(async move {
            let _stop = StopOnDrop(active.clone());
            let mut renewals = Renewals::default();
            let mut tick = tokio::time::interval(Duration::from_millis(100));
            let mut next = Instant::now();
            let mut generation = 0;
            // What the viewer has been told about pausing; None means "tell it the current state".
            let mut told_paused: Option<bool> = None;
            let result: Result<(), Error> = async {
                loop {
                    let elapsed = epoch.elapsed().as_millis() as u64;
                    let last = lease.load(Ordering::Acquire);
                    if !active.load(Ordering::Acquire) || deadline.is_some_and(|end| Instant::now() >= end) {
                        break;
                    }
                    if (last != 0 && remaining(last, elapsed).is_none())
                        || (last == 0 && elapsed >= MAX_AGE_MS)
                    {
                        println!("Signaling stopped: authorization renewal expired.");
                        break;
                    }
                    tokio::select! {
                        _ = tick.tick() => {
                            let paused = crate::pause::is_paused();
                            if told_paused != Some(paused) {
                                if told_paused.is_some() || paused {
                                    timeout(Duration::from_millis(500), raw.send(Message::Text(json!({"type":"paused","paused":paused}).to_string().into()))).await??;
                                }
                                told_paused = Some(paused);
                            }
                            if Instant::now() >= next {
                                let nonce = renewals.issue(epoch.elapsed().as_millis() as u64);
                                timeout(Duration::from_millis(500), raw.send(Message::Text(json!({"type":"renew","nonce":nonce}).to_string().into()))).await??;
                                next = Instant::now() + Duration::from_secs(1);
                            }
                        }
                        message = sender.recv() => {
                            let Some(message) = message else {break;};
                            let closing = matches!(message, Message::Close(_));
                            timeout(Duration::from_millis(500), raw.send(message)).await??;
                            if closing {break;}
                        }
                        message = raw.next() => {
                            let Some(message) = message else {break;};
                            let message = message?;
                            match &message {
                                Message::Text(text) if text.len() <= 65536 => {
                                    let body: Value = serde_json::from_str(text)?;
                                    if body["type"] == "lease" {
                                        let now = epoch.elapsed().as_millis() as u64;
                                        let last = lease.load(Ordering::Acquire);
                                        if !active.load(Ordering::Acquire) || deadline.is_some_and(|end| Instant::now() >= end) || (last != 0 && remaining(last, now).is_none()) || (last == 0 && now >= MAX_AGE_MS) {break;}
                                        if body["expiresAtMillis"].as_u64() != Some(expires_at) || body["maxAgeMs"].as_u64() != Some(MAX_AGE_MS) {
                                            return Err("Invalid lease".into());
                                        }
                                        // Fresh relay credentials ride on the lease; a bad set is refused whole.
                                        if let Some(servers) = body.get("iceServers") {
                                            let servers: Vec<IceServer> = serde_json::from_value(servers.clone())?;
                                            validate_ice_servers(&ice.0, &ice.1, &servers)?;
                                            if let Ok(mut current) = ice.2.lock() {
                                                *current = servers;
                                            }
                                        }
                                        if let Some(issued) = renewals.acknowledge(body["nonce"].as_str().ok_or("Missing lease challenge")?, epoch.elapsed().as_millis() as u64) {
                                            lease.fetch_max(issued, Ordering::Release);
                                        }
                                        continue;
                                    }
                                    if body["type"] == "ended" {break;}
                                    if body["type"] == "viewer-detached" {
                                        viewer.store(u64::MAX, Ordering::Release);
                                    } else if body["type"] == "viewer-resumed" {
                                        if body["generation"].as_u64() != Some(generation + 1) || generation >= MAX_GENERATIONS {return Err("Invalid recovery generation".into());}
                                        generation += 1;
                                        viewer.store(generation, Ordering::Release);
                                        told_paused = None;
                                    }
                                }
                                Message::Ping(_) | Message::Pong(_) => continue,
                                _ => break,
                            }
                            // A stalled consumer must never stall renewal or
                            // retain authorization indefinitely.
                            incoming.try_send(Ok(message)).map_err(|_| "Signaling consumer stalled")?;
                        }
                    }
                }
                Ok(())
            }.await;
            if let Err(error) = result {
                println!("Signaling stopped: invalid message or stalled transport.");
                let _ = incoming.try_send(Err(error));
            }
            active.store(false, Ordering::Release);
            let _ = timeout(Duration::from_millis(500), raw.close(None)).await;
        });
        (
            Self {
                incoming: receiver,
                outgoing,
                viewer_generation,
            },
            task,
        )
    }

    async fn next(&mut self) -> Option<Result<Message, Error>> {
        self.incoming.recv().await
    }
    async fn send(&mut self, message: Message) -> Result<(), Error> {
        self.outgoing.send(message).await.map_err(Into::into)
    }
    async fn close(&mut self, _: Option<()>) -> Result<(), Error> {
        self.send(Message::Close(None)).await
    }
}

// Capture is fully stopped while waiting; only the original visible local
// approval survives a bounded browser reload. Stop/lock/expiry still terminate.
async fn wait_for_viewer(
    socket: &mut SignalSocket,
    grant: &Grant,
    deadline: Option<Instant>,
    active: Arc<AtomicBool>,
    authorization: &mut MediaAuthorization,
    expected_generation: u64,
) -> Result<bool, Error> {
    let window = Duration::from_secs(grant.reconnect_seconds.unwrap_or(120).clamp(5, 900));
    let until = deadline.map_or(Instant::now() + window, |end| {
        (Instant::now() + window).min(end)
    });
    let epoch = authorization.epoch;
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    loop {
        if !active.load(Ordering::Acquire)
            || Instant::now() >= until
            || remaining(
                authorization.lease.load(Ordering::Acquire),
                epoch.elapsed().as_millis() as u64,
            )
            .is_none()
        {
            return Ok(false);
        }
        tokio::select! {
            _ = tick.tick() => {},
            message = socket.next() => {
                let text = match message { Some(Ok(Message::Text(text))) if text.len() <= 65536 => text,
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue, _ => return Ok(false) };
                let body: Value = serde_json::from_str(&text)?;
                match body["type"].as_str() {
                    Some("viewer-resumed") => return Ok(body["generation"].as_u64() == Some(expected_generation) && expected_generation <= MAX_GENERATIONS && active.load(Ordering::Acquire) && Instant::now() < until),
                    Some("ended") => return Ok(false),
                    // Packets from the old transport cannot start capture.
                    Some("candidate" | "answer" | "viewer-detached") => {},
                    _ => return Err("Unexpected recovery signaling".into()),
                }
            }
        }
    }
}

async fn media_cycle(
    socket: &mut SignalSocket,
    grant: &Grant,
    deadline: Option<Instant>,
    session_active: Arc<AtomicBool>,
    indicator_connected: Arc<AtomicBool>,
    authorization: &mut MediaAuthorization,
    generation: u64,
) -> Result<bool, Error> {
    let desktop = grant.source == "desktop";
    let control_allowed = authorization.control_allowed;
    let setup_started = Instant::now();
    indicator_connected.store(false, Ordering::Release);
    let connected = Arc::new(AtomicBool::new(false));
    let active = Arc::new(AtomicBool::new(true));
    let _stop = StopOnDrop(active.clone());
    let disconnected = Arc::new(AtomicBool::new(false));
    let failed = Arc::new(AtomicBool::new(false));
    let (local_candidates, mut candidate_receiver) = mpsc::channel(16);
    let lease = authorization.lease.clone();
    let epoch = authorization.epoch;
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
    let config = RTCConfigurationBuilder::new()
        .with_ice_transport_policy(if grant.ice_transport_policy == "relay" {
            RTCIceTransportPolicy::Relay
        } else {
            RTCIceTransportPolicy::All
        })
        .with_ice_servers(
            authorization
                .ice
                .lock()
                .map_err(|_| "ICE servers unavailable")?
                .clone()
                .into_iter()
                .map(|s| RTCIceServer {
                    urls: s.urls,
                    username: s.username.unwrap_or_default(),
                    credential: s.credential.unwrap_or_default(),
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
            candidates: local_candidates,
            connected: connected.clone(),
            active: active.clone(),
            disconnected: disconnected.clone(),
            failed: failed.clone(),
            started: setup_started,
            generation,
        }))
        .with_udp_addrs(vec!["0.0.0.0:0".to_owned()])
        .build()
        .await?;
    let track = Arc::new(TrackLocalStaticSample::new(
        Instant::now(),
        MediaStreamTrack::new(
            "beacon-test-stream".into(),
            "beacon-test-video".into(),
            if desktop {
                "Desktop".into()
            } else {
                "Synthetic video — no desktop".into()
            },
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
    let input_worker = if grant.capability == "desktop:control" && control_allowed {
        let channel = pc
            .create_data_channel(
                "beacon-input-v1",
                Some(webrtc::data_channel::RTCDataChannelInit {
                    ordered: true,
                    ..Default::default()
                }),
            )
            .await?;
        Some(crate::input_transport::start(
            channel,
            crate::input_transport::Authority {
                session: grant.id.clone(),
                display_id: grant.display_id.clone(),
                deadline,
                epoch,
                lease: lease.clone(),
                session_active: session_active.clone(),
                peer_active: active.clone(),
                connected: connected.clone(),
            },
        ))
    } else {
        None
    };
    pc.set_local_description(pc.create_offer(None).await?)
        .await?;
    let description = pc
        .local_description()
        .await
        .ok_or("Missing local description")?;
    timeout(
        Duration::from_millis(500),
        socket.send(Message::Text(
            json!({"type":"offer","sdp":description.sdp,"generation":generation})
                .to_string()
                .into(),
        )),
    )
    .await??;
    println!(
        "Media offer ready: generation {generation}, setup {} ms.",
        setup_started.elapsed().as_millis()
    );
    let (packets, mut receiver) = mpsc::channel::<crate::encoder::EncodedFrame>(2);
    let worker_active = active.clone();
    let worker_connected = connected.clone();
    let worker_lease = lease.clone();
    let worker_session_active = session_active.clone();
    let worker_display = grant.display_id.clone();
    let viewer_generation = socket.viewer_generation.clone();
    let worker_viewer_generation = viewer_generation.clone();
    let worker = tokio::task::spawn_blocking(move || -> Result<(), Error> {
        let mut encoder = Encoder::new(1280, 720, 30, 2_500_000)?;
        let mut nv12 = vec![128; 1280 * 720 * 3 / 2];
        let mut index = 0;
        let mut capture = None::<crate::capture::DesktopCapture>;
        while worker_active.load(Ordering::Acquire)
            && worker_session_active.load(Ordering::Acquire)
            && deadline.is_none_or(|end| Instant::now() < end)
        {
            let last = worker_lease.load(Ordering::Acquire);
            let elapsed = epoch.elapsed().as_millis() as u64;
            if last != 0 && remaining(last, elapsed).is_none() {
                println!("Media stopped: authorization renewal expired.");
                break;
            }
            if !worker_connected.load(Ordering::Acquire)
                || last == 0
                || crate::pause::is_paused()
                || worker_viewer_generation.load(Ordering::Acquire) != generation
            {
                // Drop the capture source, including cached pixels, while the
                // viewer is absent. Its lifetime is independent of local Stop.
                capture.take();
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            let started = Instant::now();
            if desktop {
                if capture.is_none() {
                    capture = Some(crate::capture::DesktopCapture::start_with_session(
                        Arc::new(AtomicBool::new(true)),
                        worker_session_active.clone(),
                        worker_display.as_deref(),
                    )?);
                }
                let Some(frame) = capture.as_mut().ok_or("Capture unavailable")?.snapshot()? else {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                };
                crate::pixels::nv12(&frame.bgra, frame.width, frame.height, &mut nv12, 1280, 720)?;
            } else {
                for (offset, pixel) in nv12[..1280 * 720].iter_mut().enumerate() {
                    *pixel = 16 + ((offset / 1280 + index as usize * 4) % 220) as u8;
                }
            }
            if !worker_active.load(Ordering::Acquire)
                || !worker_session_active.load(Ordering::Acquire)
            {
                break;
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
    let mut detached = false;
    let result:Result<(),Error> = async {
        let mut tick=tokio::time::interval(Duration::from_millis(100));
        let mut answered=false;
        let mut reported_first_packet=false;
        let mut requested_retry=false;
        let mut remote_candidates=Vec::<RTCIceCandidateInit>::new();

        let mut disconnected_at=None::<Instant>;
        loop {
            let last=lease.load(Ordering::Acquire);
            if last!=0 && remaining(last,epoch.elapsed().as_millis() as u64).is_none() {
                println!("Signaling stopped: authorization renewal expired.");
                break;
            }
            tokio::select! {
                candidate=candidate_receiver.recv()=>{
                    let Some(candidate)=candidate else {break;};
                    timeout(Duration::from_millis(500),socket.send(Message::Text(json!({"type":"candidate","candidate":candidate.candidate,"sdpMid":candidate.sdp_mid,"sdpMLineIndex":candidate.sdp_mline_index,"generation":generation}).to_string().into()))).await??;
                }
                _=tick.tick()=>{
                    indicator_connected.store(connected.load(Ordering::Acquire), Ordering::Release);
                    if !active.load(Ordering::Acquire) || !session_active.load(Ordering::Acquire) || deadline.is_some_and(|end| Instant::now() >= end) {break;}
                    if failed.load(Ordering::Acquire) && !requested_retry {
                        timeout(Duration::from_millis(500),socket.send(Message::Text(json!({"type":"retry","generation":generation}).to_string().into()))).await??;
                        requested_retry=true;
                    }
                    if disconnected.load(Ordering::Acquire) {
                        let lost = disconnected_at.get_or_insert_with(Instant::now);
                        if lost.elapsed() >= Duration::from_secs(3) {break;}
                    } else {
                        disconnected_at = None;
                    }

                }
                packet=receiver.recv()=>{
                    let Some(packet)=packet else {break;};
                    if !active.load(Ordering::Acquire) || !session_active.load(Ordering::Acquire) || deadline.is_some_and(|end| Instant::now() >= end) {break;}
                    if !connected.load(Ordering::Acquire) || viewer_generation.load(Ordering::Acquire) != generation {continue;}
                    if !answered {return Err("Media arrived before answer".into());}
                    let parameters=timeout(Duration::from_millis(500),sender.get_parameters()).await??;
                    let payload=parameters.rtp_parameters.codecs.first().ok_or("No negotiated codec")?.payload_type;
                    // Queued packets must not outlive renewal or the absolute grant deadline.
                    let Some(lease_remaining)=remaining(lease.load(Ordering::Acquire),epoch.elapsed().as_millis() as u64) else {break;};
                    if !active.load(Ordering::Acquire) || !session_active.load(Ordering::Acquire) {break;}
                    if !connected.load(Ordering::Acquire) || viewer_generation.load(Ordering::Acquire) != generation {continue;}
                    let budget=lease_remaining.min(deadline.map_or(lease_remaining, |end| end.saturating_duration_since(Instant::now()))).min(Duration::from_millis(500));
                    if budget.is_zero() {break;}
                    timeout(budget,track.sample_writer(7_230_001,payload).write_sample(&Sample{data:bytes::Bytes::from(packet.bytes),duration:Duration::from_secs_f64(1.0/30.0),..Sample::new(Instant::now())})).await??;
                    if !reported_first_packet {println!("First video packet sent: generation {generation}, {} ms.",setup_started.elapsed().as_millis()); reported_first_packet=true;}
                }
                message=socket.next()=>{
                    let text=match message {Some(Ok(Message::Text(text)))=>text,Some(Ok(Message::Ping(_) | Message::Pong(_)))=>continue,_=>break};
                    if text.len()>65536 {return Err("Oversized signaling".into());}
                    let body:Value=serde_json::from_str(&text)?;
                    match body["type"].as_str() {
                        Some("answer")=>{
                            if body["generation"].as_u64().unwrap_or(0) != generation {continue;}
                            if answered{return Err("Repeated answer".into());}
                            let sdp=body["sdp"].as_str().filter(|s|s.len()<=32768).ok_or("Invalid answer")?;
                            timeout(Duration::from_secs(2),pc.set_remote_description(RTCSessionDescription::answer(sdp.into())?)).await??;
                            answered=true;
                            for candidate in remote_candidates.drain(..) {timeout(Duration::from_millis(500),pc.add_ice_candidate(candidate)).await??;}
                        }
                        Some("candidate")=>{
                            if body["generation"].as_u64().unwrap_or(0) != generation {continue;}
                            let candidate=body["candidate"].as_str().filter(|s|s.len()<=2048).ok_or("Invalid candidate")?;
                            if !candidate.is_empty(){
                                let candidate=RTCIceCandidateInit{candidate:candidate.into(),sdp_mid:body["sdpMid"].as_str().map(String::from),sdp_mline_index:body["sdpMLineIndex"].as_u64().map(|v|v as u16),..Default::default()};
                                if answered {timeout(Duration::from_millis(500),pc.add_ice_candidate(candidate)).await??;}
                                else {if remote_candidates.len()>=16 {return Err("Too many early candidates".into());} remote_candidates.push(candidate);}
                            }
                        }
                        Some("ended")=>break,
                        Some("viewer-detached")=>{ detached = true; break; },
                        Some("joined")=>{},
                        _=>return Err("Unexpected signaling".into())
                    }
                }
            }
        } Ok(())
    }.await;
    active.store(false, Ordering::Release);
    if let Some(input_worker) = input_worker {
        let _ = timeout(Duration::from_secs(1), input_worker).await;
    }
    indicator_connected.store(false, Ordering::Release);
    let cleanup_started = Instant::now();
    let (_, worker) = tokio::join!(
        timeout(Duration::from_secs(2), pc.close()),
        timeout(Duration::from_secs(3), worker)
    );
    worker???;
    println!(
        "Media cleanup: generation {generation}, {} ms, viewer detached {detached}.",
        cleanup_started.elapsed().as_millis()
    );
    println!(
        "{}",
        if desktop {
            "Desktop sharing stopped. Nothing recorded."
        } else {
            "Synthetic video stopped. Nothing recorded or captured."
        }
    );
    result?;
    Ok(detached
        && session_active.load(Ordering::Acquire)
        && deadline.is_none_or(|end| Instant::now() < end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn renewal_continues_while_media_consumer_is_busy_then_stop_closes_signaling() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (connection, _) = listener.accept().await.unwrap();
            let mut peer = tokio_tungstenite::accept_async(connection).await.unwrap();
            let mut challenges = 0;
            while let Some(Ok(Message::Text(text))) = peer.next().await {
                let body: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(body["type"], "renew");
                challenges += 1;
                peer.send(Message::Text(json!({"type":"lease","nonce":body["nonce"],"maxAgeMs":MAX_AGE_MS,"expiresAtMillis":120999}).to_string().into())).await.unwrap();
            }
            challenges
        });
        let (raw, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
            .await
            .unwrap();
        let active = Arc::new(AtomicBool::new(true));
        let lease = Arc::new(AtomicU64::new(0));
        let epoch = Instant::now();
        let (_socket, pump) = SignalSocket::start(
            raw,
            120999,
            Some(Instant::now() + Duration::from_secs(20)),
            active.clone(),
            epoch,
            lease.clone(),
            (
                grant().id,
                grant().ice_transport_policy,
                Arc::new(std::sync::Mutex::new(grant().ice_servers)),
            ),
        );
        // Reproduce a rebuild/cleanup that lasts longer than one lease. No
        // media consumer reads signaling, and no desktop or consent is opened.
        tokio::time::sleep(Duration::from_millis(MAX_AGE_MS + 300)).await;
        assert!(active.load(Ordering::Acquire));
        assert!(lease.load(Ordering::Acquire) > 2000);
        assert!(remaining(
            lease.load(Ordering::Acquire),
            epoch.elapsed().as_millis() as u64
        )
        .is_some());
        active.store(false, Ordering::Release);
        timeout(Duration::from_secs(1), pump)
            .await
            .unwrap()
            .unwrap();
        assert!(
            timeout(Duration::from_secs(1), server)
                .await
                .unwrap()
                .unwrap()
                >= 3
        );
    }

    #[tokio::test]
    async fn a_reconnected_peer_clears_the_old_disconnect_latch() {
        let (candidates, _) = mpsc::channel(1);
        let handler = Handler {
            candidates,
            connected: Arc::new(AtomicBool::new(false)),
            active: Arc::new(AtomicBool::new(true)),
            disconnected: Arc::new(AtomicBool::new(false)),
            failed: Arc::new(AtomicBool::new(false)),
            started: Instant::now(),
            generation: 0,
        };
        handler
            .on_connection_state_change(RTCPeerConnectionState::Disconnected)
            .await;
        assert!(handler.disconnected.load(Ordering::Acquire));
        assert!(!handler.failed.load(Ordering::Acquire));
        assert!(!handler.connected.load(Ordering::Acquire));
        handler
            .on_connection_state_change(RTCPeerConnectionState::Connected)
            .await;
        assert!(!handler.disconnected.load(Ordering::Acquire));
        assert!(handler.connected.load(Ordering::Acquire));
        handler
            .on_connection_state_change(RTCPeerConnectionState::Failed)
            .await;
        assert!(handler.failed.load(Ordering::Acquire));
        assert!(!handler.connected.load(Ordering::Acquire));
        assert!(handler.disconnected.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn signaling_authorization_cannot_survive_missing_lease_or_invalid_deadline() {
        for (invalid_deadline, unlimited) in [(false, false), (true, false), (false, true)] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (connection, _) = listener.accept().await.unwrap();
                let mut peer = tokio_tungstenite::accept_async(connection).await.unwrap();
                while let Some(Ok(Message::Text(text))) = peer.next().await {
                    if invalid_deadline {
                        let body: Value = serde_json::from_str(&text).unwrap();
                        let _ = peer.send(Message::Text(json!({"type":"lease","nonce":body["nonce"],"maxAgeMs":MAX_AGE_MS,"expiresAtMillis":121000}).to_string().into())).await;
                    }
                }
            });
            let (raw, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
                .await
                .unwrap();
            let active = Arc::new(AtomicBool::new(true));
            let lease = Arc::new(AtomicU64::new(0));
            let (_socket, pump) = SignalSocket::start(
                raw,
                120999,
                (!unlimited).then_some(Instant::now() + Duration::from_secs(20)),
                active.clone(),
                Instant::now(),
                lease.clone(),
                (
                    grant().id,
                    grant().ice_transport_policy,
                    Arc::new(std::sync::Mutex::new(grant().ice_servers)),
                ),
            );
            timeout(Duration::from_secs(4), pump)
                .await
                .unwrap()
                .unwrap();
            assert!(!active.load(Ordering::Acquire));
            assert_eq!(lease.load(Ordering::Acquire), 0);
            timeout(Duration::from_secs(1), server)
                .await
                .unwrap()
                .unwrap();
        }
    }

    #[tokio::test]
    async fn pending_consent_observes_real_signaling_cancel_and_close() {
        // A real loopback WebSocket, with no dialog, capture, credentials or RTC.
        for remote_end in [true, false] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (connection, _) = listener.accept().await.unwrap();
                let mut peer = tokio_tungstenite::accept_async(connection).await.unwrap();
                peer.send(Message::Text(
                    json!({"type":"joined","role":"machine","source":"desktop"})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                if remote_end {
                    peer.send(Message::Text(json!({"type":"ended"}).to_string().into()))
                        .await
                        .unwrap();
                } else {
                    peer.close(None).await.unwrap();
                }
            });
            let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
                .await
                .unwrap();
            let accepted = timeout(
                Duration::from_secs(2),
                consent_while_signaling(
                    &mut socket,
                    std::future::pending::<Result<bool, Error>>(),
                    Instant::now() + Duration::from_secs(10),
                    false,
                ),
            )
            .await
            .unwrap()
            .unwrap();
            assert!(
                !accepted,
                "remote cancellation must end an unanswered prompt"
            );
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn pending_consent_expires_and_rejects_invalid_or_late_approval() {
        let mut silent = futures_util::stream::pending::<Result<Message, io::Error>>();
        assert!(!timeout(
            Duration::from_secs(1),
            consent_while_signaling(
                &mut silent,
                std::future::pending::<Result<bool, Error>>(),
                Instant::now() + Duration::from_millis(20),
                false,
            )
        )
        .await
        .unwrap()
        .unwrap());

        let joined = || {
            Message::Text(
                json!({"type":"joined","role":"machine","source":"desktop"})
                    .to_string()
                    .into(),
            )
        };
        let mut ended = futures_util::stream::iter([
            Ok::<_, io::Error>(joined()),
            Ok(Message::Text(json!({"type":"ended"}).to_string().into())),
        ]);
        // This is a late-result fixture, not a real native approval. Observable
        // cancellation wins even when the dialog result is already available.
        assert!(!consent_while_signaling(
            &mut ended,
            async { Ok(true) },
            Instant::now() + Duration::from_secs(1),
            false,
        )
        .await
        .unwrap());
        let mut wrong_role = futures_util::stream::iter([Ok::<_, io::Error>(Message::Text(
            json!({"type":"joined","role":"viewer","source":"desktop"})
                .to_string()
                .into(),
        ))]);
        assert!(consent_while_signaling(
            &mut wrong_role,
            async { Ok(true) },
            Instant::now() + Duration::from_secs(1),
            false,
        )
        .await
        .is_err());
    }

    fn grant() -> Grant {
        serde_json::from_value(json!({
            "id": "12345678-1234-1234-1234-123456789abc",
            "token": "a".repeat(43),
            "server": "https://remote.example.test",
            "source": "synthetic",
            "controller": "fixture@example.test",
            "expiresAtMillis": 120999,
            "iceTransportPolicy": "relay",
            "iceServers": [{
                "urls": ["turn:relay.example.test:3478?transport=udp"],
                "username": format!("{}:beacon-remote:12345678-1234-1234-1234-123456789abc", now_millis().unwrap() / 1000 + 600),
                "credential": "a".repeat(27) + "="
            }]
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn a_view_scope_handshake_cannot_authorize_control() {
        // No native dialog or OS input; checks the authenticated server join.
        let mut socket = futures_util::stream::iter([Ok::<_, io::Error>(Message::Text(
            json!({"type":"joined", "role":"machine", "source":"desktop", "capability":"desktop:view"}).to_string().into(),
        ))]);
        assert!(consent_while_signaling(
            &mut socket,
            async { Ok(true) },
            Instant::now() + Duration::from_secs(1),
            true
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn browser_recovery_obeys_original_lease_stop_deadline_and_generation() {
        // Real signaling sockets only: no consent dialog, capture or media.
        for mode in [
            "resume",
            "wrong-generation",
            "stop",
            "deadline",
            "lease",
            "ended",
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (connection, _) = listener.accept().await.unwrap();
                let mut peer = tokio_tungstenite::accept_async(connection).await.unwrap();
                let body = if mode == "ended" {
                    json!({"type":"ended"})
                } else {
                    json!({"type":"viewer-resumed", "generation":if mode == "wrong-generation" { 0 } else { 1 }})
                };
                let _ = peer.send(Message::Text(body.to_string().into())).await;
                while let Some(Ok(message)) = peer.next().await {
                    if matches!(message, Message::Close(_)) {
                        break;
                    }
                }
            });
            let (raw, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
                .await
                .unwrap();
            let active = Arc::new(AtomicBool::new(mode != "stop"));
            let mut authorization = MediaAuthorization {
                control_allowed: false,
                epoch: Instant::now()
                    - Duration::from_millis(if mode == "lease" { MAX_AGE_MS + 1 } else { 10 }),
                lease: Arc::new(AtomicU64::new(1)),
                ice: Arc::new(std::sync::Mutex::new(grant().ice_servers)),
            };
            let deadline = if mode == "deadline" {
                Instant::now()
            } else {
                Instant::now() + Duration::from_secs(20)
            };
            let (mut socket, pump) = SignalSocket::start(
                raw,
                grant().expires_at_millis,
                Some(deadline),
                active.clone(),
                authorization.epoch,
                authorization.lease.clone(),
                (
                    grant().id,
                    grant().ice_transport_policy,
                    authorization.ice.clone(),
                ),
            );
            let resumed = timeout(
                Duration::from_secs(1),
                wait_for_viewer(
                    &mut socket,
                    &grant(),
                    Some(deadline),
                    active,
                    &mut authorization,
                    1,
                ),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(resumed, mode == "resume", "{mode}");
            let _ = socket.close(None).await;
            let _ = timeout(Duration::from_secs(1), pump).await.unwrap();
            timeout(Duration::from_secs(1), server)
                .await
                .unwrap()
                .unwrap();
        }
    }

    #[test]
    fn relay_grants_bind_credentials_to_session_and_reject_missing_or_mixed_fields() {
        let mut valid = grant();
        assert!(validate_ice(&valid).is_ok());
        for url in [
            "turn:relay.example.test:3478?transport=tcp",
            "turns:relay.example.test:5349?transport=tcp",
        ] {
            valid = grant();
            valid.ice_servers[0].urls[0] = url.into();
            assert!(validate_ice(&valid).is_err());
        }
        valid = grant();
        valid.ice_servers[0].username = Some(format!(
            "{}:beacon-remote:another-session",
            now_millis().unwrap() / 1000 + 600
        ));
        assert!(validate_ice(&valid).is_err());
        valid = grant();
        valid.ice_servers[0].credential = None;
        assert!(validate_ice(&valid).is_err());
        valid = grant();
        valid.ice_servers[0]
            .urls
            .push("stun:relay.example.test:3478".into());
        assert!(validate_ice(&valid).is_err());
        valid = grant();
        valid.ice_servers[0].urls[0] = "https://relay.example.test".into();
        assert!(validate_ice(&valid).is_err());
        valid = grant();
        valid.ice_transport_policy = "unrecognized".into();
        assert!(validate_ice(&valid).is_err());
    }

    #[test]
    fn direct_grants_accept_stun_but_relay_requires_authenticated_turn() {
        let mut valid = grant();
        valid.ice_servers = vec![IceServer {
            urls: vec!["stun:relay.example.test:3478".into()],
            username: None,
            credential: None,
        }];
        assert!(validate_ice(&valid).is_err());
        valid.ice_transport_policy = "all".into();
        assert!(validate_ice(&valid).is_ok());
        valid.ice_servers[0].credential = Some("unexpected".into());
        assert!(validate_ice(&valid).is_err());
        valid.ice_servers.clear();
        assert!(validate_ice(&valid).is_err());
    }
}
