//! Worker-owned signaling; it cannot construct authority or connect the media gate.
use crate::{signin_endpoint, signin_scope::SignInScope, validate_server, HostError};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::{
    io::ErrorKind,
    net::{Shutdown, TcpStream, ToSocketAddrs},
    os::windows::io::AsRawHandle,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tungstenite::{
    client::IntoClientRequest,
    client_tls_with_config,
    protocol::{Message, WebSocketConfig},
    stream::MaybeTlsStream,
    WebSocket,
};
use windows_sys::Win32::System::Threading::WaitForSingleObject;
use zeroize::{Zeroize, Zeroizing};

fn rejected() -> HostError {
    "Sign-in signaling ended or was rejected".into()
}
#[derive(Clone)]
struct Binding {
    lease: String,
    instance: String,
    console: u32,
}
trait Gate: Send + Sync {
    fn check(&self) -> Result<(), HostError>;
    fn stop(&self);
}
struct ScopeGate(Arc<SignInScope>);
impl Gate for ScopeGate {
    fn check(&self) -> Result<(), HostError> {
        self.0.authorize_signaling()
    }
    fn stop(&self) {
        self.0.stop();
    }
}
struct EndScope(Arc<dyn Gate>);
impl Drop for EndScope {
    fn drop(&mut self) {
        self.0.stop();
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}
impl Drop for IceServer {
    fn drop(&mut self) {
        self.username.zeroize();
        self.credential.zeroize();
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ready {
    scope: String,
    lease_id: String,
    instance_id: String,
    console_session_id: u32,
    worker_public_key: String,
    pub ice_servers: Vec<IceServer>,
    pub ice_transport_policy: String,
    files: bool,
    clipboard: bool,
    audio: bool,
    recording: bool,
    automation: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub candidate: String,
    pub sdp_mid: Option<String>,
    pub sdp_m_line_index: Option<u16>,
}
impl Candidate {
    fn valid(&self) -> bool {
        self.candidate.len() <= 2048
            && self.sdp_mid.as_ref().is_none_or(|v| v.len() <= 32)
            && self.sdp_m_line_index.is_none_or(|v| v <= 16)
    }
}
pub enum Event {
    Ready(Ready),
    PeerReady,
    Answer(String),
    Candidate(Candidate),
}
#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    Offer { sdp: String },
    Candidate(Candidate),
}
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Incoming {
    Ready(Ready),
    PeerReady { scope: String },
    Answer { sdp: String },
    Candidate(Candidate),
}
struct Protocol {
    binding: Binding,
    public_key: String,
    ready: bool,
    paired: bool,
    offered: bool,
    answered: bool,
}
fn valid_ice(ready: &Ready, lease: &str) -> bool {
    if !matches!(ready.ice_transport_policy.as_str(), "all" | "relay")
        || ready.ice_servers.is_empty()
        || ready.ice_servers.len() > 2
    {
        return false;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(u64::MAX, |v| v.as_secs());
    let mut relay = false;
    for ice in &ready.ice_servers {
        if ice.urls.is_empty() || ice.urls.len() > 3 {
            return false;
        }
        for url in &ice.urls {
            if url.len() > 256 || url.chars().any(char::is_control) {
                return false;
            }
            if let Some(address) = url.strip_prefix("stun:") {
                if address.is_empty()
                    || address.contains(['@', '#', '/', '?'])
                    || ice.username.is_some()
                    || ice.credential.is_some()
                {
                    return false;
                }
            } else if url.starts_with("turn:") || url.starts_with("turns:") {
                let Some((expiry, tail)) = ice.username.as_deref().and_then(|v| v.split_once(':'))
                else {
                    return false;
                };
                let Ok(expiry) = expiry.parse::<u64>() else {
                    return false;
                };
                if expiry <= now
                    // The server's five-minute cap plus its accepted clock skew.
                    || expiry > now.saturating_add(331)
                    || tail != format!("beacon-remote:{lease}")
                    || ice.credential.as_ref().is_none_or(|v| {
                        v.is_empty() || v.len() > 256 || v.chars().any(char::is_control)
                    })
                {
                    return false;
                }
                let Some((address, transport)) = url.split_once("?transport=") else {
                    return false;
                };
                if !matches!(transport, "udp" | "tcp")
                    || (url.starts_with("turns:") && transport != "tcp")
                    || address.contains(['@', '#', '/'])
                {
                    return false;
                }
                let Some((_, port)) = address.rsplit_once(':') else {
                    return false;
                };
                if port.parse::<u16>().ok().filter(|v| *v > 0).is_none() {
                    return false;
                }
                relay = true;
            } else {
                return false;
            }
        }
    }
    ready.ice_transport_policy != "relay" || relay
}
impl Protocol {
    fn receive(&mut self, body: &str) -> Result<Event, HostError> {
        if body.len() > 65536 {
            return Err(rejected());
        }
        let incoming: Incoming = serde_json::from_str(body).map_err(|_| rejected())?;
        match incoming {
            Incoming::Ready(ready)
                if !self.ready
                    && ready.scope == "windows:sign-in"
                    && ready.lease_id == self.binding.lease
                    && ready.instance_id == self.binding.instance
                    && ready.console_session_id == self.binding.console
                    && ready.worker_public_key == self.public_key
                    && !ready.files
                    && !ready.clipboard
                    && !ready.audio
                    && !ready.recording
                    && !ready.automation
                    && valid_ice(&ready, &self.binding.lease) =>
            {
                self.ready = true;
                Ok(Event::Ready(ready))
            }
            Incoming::PeerReady { scope }
                if self.ready && !self.paired && scope == "windows:sign-in" =>
            {
                self.paired = true;
                Ok(Event::PeerReady)
            }
            Incoming::Answer { sdp }
                if self.paired
                    && self.offered
                    && !self.answered
                    && !sdp.is_empty()
                    && sdp.len() <= 32768 =>
            {
                self.answered = true;
                Ok(Event::Answer(sdp))
            }
            Incoming::Candidate(candidate) if self.paired && candidate.valid() => {
                Ok(Event::Candidate(candidate))
            }
            _ => Err(rejected()),
        }
    }
    fn encode(&mut self, command: &Command) -> Result<String, HostError> {
        if !self.paired {
            return Err(rejected());
        }
        match command {
            Command::Offer { sdp } if !self.offered && !sdp.is_empty() && sdp.len() <= 32768 => {
                self.offered = true
            }
            Command::Candidate(candidate) if candidate.valid() => {}
            _ => return Err(rejected()),
        }
        let body = serde_json::to_string(command).map_err(|_| rejected())?;
        if body.len() > 65536 {
            return Err(rejected());
        }
        Ok(body)
    }
}
fn proof(machine: &str, binding: &Binding, key: &[u8; 32]) -> Result<String, HostError> {
    for id in [machine, binding.lease.as_str(), binding.instance.as_str()] {
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| rejected())?;
        if parsed.is_nil() || parsed.to_string() != id {
            return Err(rejected());
        }
    }
    if binding.console == 0 || binding.console == u32::MAX {
        return Err(rejected());
    }
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let nonce = uuid::Uuid::new_v4().to_string();
    let message = format!(
        "beacon-remote:signin-worker-connect:v1\n{machine}\n{timestamp}\n{nonce}\n{}\n{}\n{}",
        binding.lease, binding.instance, binding.console
    );
    let body = serde_json::json!({"version":1,"machineId":machine,"timestamp":timestamp,"nonce":nonce,
        "leaseId":binding.lease,"instanceId":binding.instance,"consoleSessionId":binding.console,
        "signature":STANDARD.encode(SigningKey::from_bytes(key).sign(message.as_bytes()).to_bytes())});
    Ok(format!(
        "Beacon-SignIn {}",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&body).map_err(|_| rejected())?)
    ))
}
type Socket = WebSocket<MaybeTlsStream<TcpStream>>;
fn tcp(stream: &MaybeTlsStream<TcpStream>) -> Result<&TcpStream, HostError> {
    match stream {
        MaybeTlsStream::Plain(stream) => Ok(stream),
        MaybeTlsStream::Rustls(stream) => Ok(&stream.sock),
        _ => Err(rejected()),
    }
}
fn idle(error: &tungstenite::Error) -> bool {
    matches!(error,tungstenite::Error::Io(error) if matches!(error.kind(),ErrorKind::WouldBlock|ErrorKind::TimedOut))
}
fn connect(
    server: &reqwest::Url,
    machine: &str,
    binding: &Binding,
    key: &[u8; 32],
    gate: &dyn Gate,
) -> Result<Socket, HostError> {
    gate.check()?;
    let host = server.host_str().ok_or_else(rejected)?;
    let port = server.port_or_known_default().ok_or_else(rejected)?;
    let started = Instant::now();
    // DNS runs only on the owned worker thread. Scope Stop is independent;
    // process/job teardown bounds a resolver that fails to return.
    let addresses = (host, port).to_socket_addrs().map_err(|_| rejected())?;
    let mut connected = None;
    for address in addresses.take(4) {
        gate.check()?;
        if server.scheme() == "http" && !address.ip().is_loopback() {
            return Err(rejected());
        }
        if started.elapsed() >= Duration::from_secs(2) {
            return Err(rejected());
        }
        if let Ok(stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) {
            connected = Some(stream);
            break;
        }
    }
    let stream = connected.ok_or_else(rejected)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    stream.set_nodelay(true)?;
    gate.check()?;
    let mut url = server.clone();
    url.set_scheme(if server.scheme() == "https" {
        "wss"
    } else {
        "ws"
    })
    .map_err(|_| rejected())?;
    url.set_path(&format!("/api/signin/leases/{}/signal", binding.lease));
    url.set_query(Some("role=worker"));
    let mut request = url.as_str().into_client_request().map_err(|_| rejected())?;
    request.headers_mut().insert(
        "Authorization",
        proof(machine, binding, key)?
            .parse()
            .map_err(|_| rejected())?,
    );
    let config = WebSocketConfig::default()
        .max_message_size(Some(65536))
        .max_frame_size(Some(65536))
        .max_write_buffer_size(131072)
        .write_buffer_size(0);
    let (socket, _) =
        client_tls_with_config(request, stream, Some(config), None).map_err(|_| rejected())?;
    gate.check()?;
    tcp(socket.get_ref())?.set_read_timeout(Some(Duration::from_millis(50)))?;
    tcp(socket.get_ref())?.set_write_timeout(Some(Duration::from_millis(250)))?;
    Ok(socket)
}
fn flush(socket: &mut Socket, gate: &dyn Gate) -> Result<(), HostError> {
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        gate.check()?;
        match socket.flush() {
            Ok(()) => return gate.check(),
            Err(error) if idle(&error) && Instant::now() < deadline => thread::yield_now(),
            _ => return Err(rejected()),
        }
    }
}
struct Channels {
    commands: Receiver<Command>,
    events: SyncSender<Event>,
}
fn run(
    server: reqwest::Url,
    machine: String,
    binding: Binding,
    key: Zeroizing<[u8; 32]>,
    gate: Arc<dyn Gate>,
    channels: Channels,
) -> Result<(), HostError> {
    let public_key = STANDARD.encode(SigningKey::from_bytes(&key).verifying_key().as_bytes());
    let mut socket = match connect(&server, &machine, &binding, &key, gate.as_ref()) {
        Ok(socket) => socket,
        Err(error) => {
            crate::signin_worker::trace(&format!("signaling could not connect: {error}"));
            return Err(error);
        }
    };
    crate::signin_worker::trace("signaling connected");
    drop(key); // No reconnect/re-signing under this lease.
    let mut protocol = Protocol {
        binding,
        public_key,
        ready: false,
        paired: false,
        offered: false,
        answered: false,
    };
    let result = (|| {
        let mut traffic = Instant::now();
        let mut window = Instant::now();
        let mut incoming = 0;
        let mut outgoing = 0;
        loop {
            gate.check()?;
            if traffic.elapsed() > Duration::from_secs(5) {
                crate::signin_worker::trace("signaling: no reply from the server for 5 seconds");
                return Err(rejected());
            }
            if window.elapsed() >= Duration::from_secs(60) {
                window = Instant::now();
                incoming = 0;
                outgoing = 0;
            }
            match channels.commands.try_recv() {
                Ok(command) => {
                    outgoing += 1;
                    if outgoing > 256 {
                        return Err(rejected());
                    }
                    let body = protocol.encode(&command)?;
                    gate.check()?;
                    if let Err(error) = socket.send(Message::Text(body.into())) {
                        if !idle(&error) {
                            return Err(rejected());
                        }
                    }
                    // A timed-out send may already be buffered: only flush it,
                    // never enqueue the same offer/candidate a second time.
                    flush(&mut socket, gate.as_ref())?;
                }
                Err(TryRecvError::Empty) => {}
                Err(TryRecvError::Disconnected) => return Err(rejected()),
            }
            match socket.read() {
                Ok(message) => {
                    traffic = Instant::now();
                    incoming += 1;
                    if incoming > 512 {
                        return Err(rejected());
                    }
                    gate.check()?;
                    match message {
                        Message::Text(body) => {
                            let event = match protocol.receive(&body) {
                                Ok(event) => event,
                                Err(error) => {
                                    crate::signin_worker::trace(&format!(
                                        "signaling: message refused: {error}"
                                    ));
                                    return Err(error);
                                }
                            };
                            gate.check()?;
                            channels.events.try_send(event).map_err(|_| rejected())?;
                        }
                        Message::Ping(_) => flush(&mut socket, gate.as_ref())?,
                        Message::Pong(_) => {}
                        other => {
                            crate::signin_worker::trace(&format!(
                                "signaling: unexpected frame {other:?}"
                            ));
                            return Err(rejected());
                        }
                    }
                }
                Err(error) if idle(&error) => {}
                Err(error) => {
                    crate::signin_worker::trace(&format!("signaling: read failed: {error}"));
                    return Err(rejected());
                }
            }
        }
    })();
    // Discard pending signaling on teardown, rather than flushing an old offer.
    let _ = tcp(socket.get_ref())?.shutdown(Shutdown::Both);
    result
}
pub struct SignInSignaling {
    gate: Arc<dyn Gate>,
    commands: SyncSender<Command>,
    events: Receiver<Event>,
    done: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl SignInSignaling {
    pub(crate) fn start(
        machine: &str,
        scope: Arc<SignInScope>,
        key: Zeroizing<[u8; 32]>,
    ) -> Result<Self, HostError> {
        let (lease, instance, console) = scope.signaling_binding()?;
        let server = signin_endpoint::worker_server(machine).map_err(|_| {
            scope.stop();
            rejected()
        })?;
        Self::start_inner(
            server,
            machine.into(),
            Binding {
                lease,
                instance,
                console,
            },
            key,
            Arc::new(ScopeGate(scope)),
        )
    }
    fn start_inner(
        server: reqwest::Url,
        machine: String,
        binding: Binding,
        key: Zeroizing<[u8; 32]>,
        gate: Arc<dyn Gate>,
    ) -> Result<Self, HostError> {
        gate.check()?;
        let server = validate_server(server.as_str()).map_err(|_| {
            gate.stop();
            rejected()
        })?;
        let (commands, receiver) = mpsc::sync_channel(64);
        let (sender, events) = mpsc::sync_channel(64);
        let done = Arc::new(AtomicBool::new(false));
        let finished = done.clone();
        let owned_gate = gate.clone();
        let thread = thread::Builder::new()
            .name("signin-signaling".into())
            .spawn(move || {
                let _authority = EndScope(owned_gate.clone());
                match run(
                    server,
                    machine,
                    binding,
                    key,
                    owned_gate,
                    Channels {
                        commands: receiver,
                        events: sender,
                    },
                ) {
                    Ok(()) => crate::signin_worker::trace("signaling finished"),
                    Err(error) => crate::signin_worker::trace(&format!("signaling ended: {error}")),
                }
                finished.store(true, Ordering::Release);
            })
            .map_err(|_| {
                gate.stop();
                rejected()
            })?;
        Ok(Self {
            gate,
            commands,
            events,
            done,
            thread: Some(thread),
        })
    }
    pub fn send(&self, command: Command) -> Result<(), HostError> {
        self.gate.check()?;
        if self.commands.try_send(command).is_err() {
            self.gate.stop();
            return Err(rejected());
        }
        Ok(())
    }
    pub fn try_event(&self) -> Result<Option<Event>, HostError> {
        self.gate.check()?;
        match self.events.try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(TryRecvError::Empty) => Ok(None),
            Err(_) => {
                self.gate.stop();
                Err(rejected())
            }
        }
    }
    pub fn ended(&self) -> bool {
        self.done.load(Ordering::Acquire) || self.gate.check().is_err()
    }
}
impl Drop for SignInSignaling {
    fn drop(&mut self) {
        self.gate.stop();
        if let Some(thread) = self.thread.take() {
            unsafe {
                WaitForSingleObject(thread.as_raw_handle(), 500);
            }
            if thread.is_finished() {
                let _ = thread.join();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};
    use std::net::TcpListener;
    struct TestGate(AtomicBool);
    impl Gate for TestGate {
        fn check(&self) -> Result<(), HostError> {
            if self.0.load(Ordering::Acquire) {
                Err(rejected())
            } else {
                Ok(())
            }
        }
        fn stop(&self) {
            self.0.store(true, Ordering::Release);
        }
    }
    fn binding() -> Binding {
        Binding {
            lease: uuid::Uuid::new_v4().to_string(),
            instance: uuid::Uuid::new_v4().to_string(),
            console: 1,
        }
    }
    fn ready(binding: &Binding, key: &str) -> serde_json::Value {
        serde_json::json!({"type":"ready","scope":"windows:sign-in","leaseId":binding.lease,"instanceId":binding.instance,
            "consoleSessionId":binding.console,"workerPublicKey":key,"iceServers":[{"urls":["stun:127.0.0.1:3478"]}],
            "iceTransportPolicy":"all","files":false,"clipboard":false,"audio":false,"recording":false,"automation":false})
    }
    fn protocol(binding: Binding, key: String) -> Protocol {
        Protocol {
            binding,
            public_key: key,
            ready: false,
            paired: false,
            offered: false,
            answered: false,
        }
    }
    #[test]
    fn strict_ready_scope_and_negotiation_never_raise_media_authority() {
        let binding = binding();
        let key = "fixture-public-key";
        let valid = ready(&binding, key);
        for (field, value) in [
            ("scope", serde_json::json!("desktop:control")),
            (
                "leaseId",
                serde_json::json!(uuid::Uuid::new_v4().to_string()),
            ),
            (
                "instanceId",
                serde_json::json!(uuid::Uuid::new_v4().to_string()),
            ),
            ("consoleSessionId", serde_json::json!(2)),
            ("workerPublicKey", serde_json::json!("another-worker")),
            ("files", serde_json::json!(true)),
            ("command", serde_json::json!("forbidden")),
        ] {
            let mut changed = valid.clone();
            changed[field] = value;
            assert!(protocol(binding.clone(), key.into())
                .receive(&changed.to_string())
                .is_err());
        }
        let mut state = protocol(binding.clone(), key.into());
        assert!(state
            .receive(r#"{"type":"peer-ready","scope":"windows:sign-in"}"#)
            .is_err());
        assert!(matches!(
            state.receive(&valid.to_string()).unwrap(),
            Event::Ready(_)
        ));
        assert!(state.receive(&valid.to_string()).is_err());
        state
            .receive(r#"{"type":"peer-ready","scope":"windows:sign-in"}"#)
            .unwrap();
        assert!(state
            .receive(r#"{"type":"answer","sdp":"before offer"}"#)
            .is_err());
        state
            .encode(&Command::Offer {
                sdp: "synthetic-offer".into(),
            })
            .unwrap();
        assert!(state
            .encode(&Command::Offer {
                sdp: "second offer".into()
            })
            .is_err());
        assert!(matches!(
            state
                .receive(r#"{"type":"answer","sdp":"synthetic-answer"}"#)
                .unwrap(),
            Event::Answer(_)
        ));
        assert!(state
            .receive(r#"{"type":"answer","sdp":"replayed"}"#)
            .is_err());
        assert!(state
            .receive(
                r#"{"type":"candidate","candidate":"fixture","sdpMid":"0","sdpMLineIndex":17}"#
            )
            .is_err());
        assert!(state
            .receive(r#"{"type":"input","input":"forbidden"}"#)
            .is_err());
        let mut bad = valid;
        bad["iceServers"] = serde_json::json!([{"urls":["https://not-an-ice-server.example"]}]);
        assert!(protocol(binding, key.into())
            .receive(&bad.to_string())
            .is_err());
    }
    #[test]
    fn ordinary_identity_cannot_start_signaling_or_read_installed_machine_configuration() {
        let scope = SignInScope::new(
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
            1,
            crate::signin_scope::tick() + 15000 * crate::signin_scope::TICKS_PER_MILLISECOND,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!(SignInSignaling::start(
            "not-an-installed-machine",
            scope.clone(),
            Zeroizing::new([42; 32])
        )
        .is_err());
        assert!(scope.authorize().is_err());
    }
    fn accept(listener: TcpListener) -> TcpStream {
        listener.set_nonblocking(true).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error)
                    if error.kind() == ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) => panic!("fixture accept failed: {error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
    }
    fn next(client: &SignInSignaling) -> Event {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(event) = client.try_event().unwrap() {
                return event;
            }
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(5));
        }
    }
    #[test]
    fn invalid_server_messages_close_the_socket_and_end_the_scope() {
        for binary in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let server =
                reqwest::Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
            let binding = binding();
            let secret = [57u8; 32];
            let public =
                STANDARD.encode(SigningKey::from_bytes(&secret).verifying_key().as_bytes());
            let mut wrong_scope = ready(&binding, &public);
            wrong_scope["scope"] = serde_json::json!("desktop:control");
            let task = thread::spawn(move || {
                let mut socket = tungstenite::accept(accept(listener)).unwrap();
                socket
                    .send(if binary {
                        Message::Binary(vec![1, 2, 3].into())
                    } else {
                        Message::Text(wrong_scope.to_string().into())
                    })
                    .unwrap();
                assert!(socket.read().is_err());
            });
            let gate = Arc::new(TestGate(AtomicBool::new(false)));
            let client = SignInSignaling::start_inner(
                server,
                uuid::Uuid::new_v4().to_string(),
                binding,
                Zeroizing::new(secret),
                gate.clone(),
            )
            .unwrap();
            let deadline = Instant::now() + Duration::from_secs(3);
            while !gate.0.load(Ordering::Acquire) {
                assert!(
                    Instant::now() < deadline,
                    "invalid signaling did not stop authority"
                );
                thread::sleep(Duration::from_millis(5));
            }
            assert!(client.ended());
            assert!(client.try_event().is_err());
            drop(client);
            task.join().unwrap();
        }
    }
    #[test]
    // tungstenite's accept_hdr callback fixes the error to its HTTP Response.
    #[allow(clippy::result_large_err)]
    fn actual_websocket_signs_fresh_worker_proof_negotiates_and_closes_on_scope_stop() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server =
            reqwest::Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let binding = binding();
        let machine = uuid::Uuid::new_v4().to_string();
        let secret = [55u8; 32];
        let key = SigningKey::from_bytes(&secret).verifying_key();
        let public_key = STANDARD.encode(key.as_bytes());
        let expected = binding.clone();
        let client_binding = binding.clone();
        let machine_for_server = machine.clone();
        let (pong_sent, pong_received) = mpsc::sync_channel(1);
        let task = thread::spawn(move || {
            let mut socket = tungstenite::accept_hdr(
                accept(listener),
                move |request: &tungstenite::handshake::server::Request,
                      response: tungstenite::handshake::server::Response| {
                    assert_eq!(
                        request.uri().path(),
                        format!("/api/signin/leases/{}/signal", expected.lease)
                    );
                    assert_eq!(request.uri().query(), Some("role=worker"));
                    assert!(!request.headers().contains_key("cookie"));
                    assert!(!request.headers().contains_key("origin"));
                    let header = request.headers()["authorization"]
                        .to_str()
                        .unwrap()
                        .strip_prefix("Beacon-SignIn ")
                        .unwrap();
                    let body: serde_json::Value =
                        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(header).unwrap()).unwrap();
                    assert_eq!(body.as_object().unwrap().len(), 8);
                    assert_eq!(body["machineId"], machine_for_server);
                    assert_eq!(body["leaseId"], expected.lease);
                    assert_eq!(body["instanceId"], expected.instance);
                    assert_eq!(body["consoleSessionId"], expected.console);
                    assert!(
                        (SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as i128
                            - body["timestamp"].as_u64().unwrap() as i128)
                            .abs()
                            < 5000
                    );
                    uuid::Uuid::parse_str(body["nonce"].as_str().unwrap()).unwrap();
                    let message = format!(
                        "beacon-remote:signin-worker-connect:v1\n{}\n{}\n{}\n{}\n{}\n{}",
                        machine_for_server,
                        body["timestamp"],
                        body["nonce"].as_str().unwrap(),
                        expected.lease,
                        expected.instance,
                        expected.console
                    );
                    key.verify(
                        message.as_bytes(),
                        &Signature::from_slice(
                            &STANDARD
                                .decode(body["signature"].as_str().unwrap())
                                .unwrap(),
                        )
                        .unwrap(),
                    )
                    .unwrap();
                    Ok(response)
                },
            )
            .unwrap();
            socket
                .send(Message::Text(
                    ready(&binding, &public_key).to_string().into(),
                ))
                .unwrap();
            socket
                .send(Message::Text(
                    r#"{"type":"peer-ready","scope":"windows:sign-in"}"#.into(),
                ))
                .unwrap();
            let offer: serde_json::Value =
                serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
            assert_eq!(
                offer,
                serde_json::json!({"type":"offer","sdp":"synthetic-offer"})
            );
            socket
                .send(Message::Text(
                    r#"{"type":"answer","sdp":"synthetic-answer"}"#.into(),
                ))
                .unwrap();
            socket.send(Message::Text(r#"{"type":"candidate","candidate":"candidate:fixture","sdpMid":"0","sdpMLineIndex":0}"#.into())).unwrap();
            socket.send(Message::Ping(vec![1, 2, 3].into())).unwrap();
            assert!(matches!(socket.read().unwrap(), Message::Pong(_)));
            pong_sent.send(()).unwrap();
            assert!(socket.read().is_err());
        });
        let gate = Arc::new(TestGate(AtomicBool::new(false)));
        let client = SignInSignaling::start_inner(
            server,
            machine,
            client_binding,
            Zeroizing::new(secret),
            gate.clone(),
        )
        .unwrap();
        assert!(matches!(next(&client), Event::Ready(_)));
        assert!(matches!(next(&client), Event::PeerReady));
        client
            .send(Command::Offer {
                sdp: "synthetic-offer".into(),
            })
            .unwrap();
        assert!(matches!(next(&client),Event::Answer(sdp) if sdp=="synthetic-answer"));
        assert!(
            matches!(next(&client),Event::Candidate(candidate) if candidate.candidate=="candidate:fixture")
        );
        pong_received.recv_timeout(Duration::from_secs(3)).unwrap();
        gate.stop();
        assert!(client.ended());
        assert!(client
            .send(Command::Offer {
                sdp: "after-stop".into()
            })
            .is_err());
        drop(client);
        task.join().unwrap();
    }
}
