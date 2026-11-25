//! Supervisor-only discovery/authorization. No private identity crosses worker IPC.
use crate::{signin_ipc::SignInMessage, signin_scope, HostError};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::Deserialize;
use std::{
    io::Read,
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) struct LeaseClient<'a> {
    pub http: &'a reqwest::blocking::Client,
    pub server: &'a reqwest::Url,
    pub key: &'a SigningKey,
    pub machine: &'a str,
    pub instance: &'a str,
    pub console: u32,
}
fn rejected() -> HostError {
    "Sign-in lease exchange rejected".into()
}
fn discovery(body: &[u8]) -> Result<Option<String>, HostError> {
    fn explicit_nullable<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<String>, D::Error> {
        Option::<String>::deserialize(deserializer)
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Reply {
        #[serde(deserialize_with = "explicit_nullable")]
        lease_id: Option<String>,
    }
    if body.len() > 4096 {
        return Err(rejected());
    }
    // Require the field even for an idle endpoint; missing is not an explicit null.
    let reply: Reply = serde_json::from_slice(body).map_err(|_| rejected())?;
    if let Some(id) = &reply.lease_id {
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| rejected())?;
        if parsed.is_nil() || parsed.to_string() != *id {
            return Err(rejected());
        }
    }
    Ok(reply.lease_id)
}
impl LeaseClient<'_> {
    fn proof(&self, lease: Option<&str>) -> Result<serde_json::Value, HostError> {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        let nonce = uuid::Uuid::new_v4().to_string();
        let (machine, instance, console) = (self.machine, self.instance, self.console);
        let message = match lease {
            Some(lease) => format!("beacon-remote:signin-lease:v1\n{machine}\n{timestamp}\n{nonce}\n{lease}\n{instance}\n{console}"),
            None => format!("beacon-remote:signin-pending:v1\n{machine}\n{timestamp}\n{nonce}\n{instance}\n{console}"),
        };
        let mut body = serde_json::json!({"version":1,"machineId":machine,"timestamp":timestamp,"nonce":nonce,
            "instanceId":instance,"consoleSessionId":console,"signature":STANDARD.encode(self.key.sign(message.as_bytes()).to_bytes())});
        if let Some(lease) = lease {
            body["leaseId"] = lease.into();
        }
        Ok(body)
    }
    fn exchange(&self, lease: Option<&str>) -> Result<Vec<u8>, HostError> {
        let path = if lease.is_some() {
            "/api/signin/authorize"
        } else {
            "/api/signin/pending"
        };
        let response = self
            .http
            .post(self.server.join(path)?)
            .json(&self.proof(lease)?)
            .send()
            .map_err(|_| rejected())?;
        if !response.status().is_success() {
            return Err(rejected());
        }
        let mut body = Vec::new();
        response
            .take(4097)
            .read_to_end(&mut body)
            .map_err(|_| rejected())?;
        if body.len() > 4096 {
            return Err(rejected());
        }
        Ok(body)
    }
    pub fn discover(&self) -> Result<Option<String>, HostError> {
        discovery(&self.exchange(None)?)
    }
    pub fn authorize(&self, lease: &str) -> Result<SignInMessage, HostError> {
        let started = signin_scope::tick();
        let body = self.exchange(Some(lease))?;
        Ok(SignInMessage::authorization_reply(
            &body,
            lease,
            self.instance,
            self.console,
            started,
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};
    use std::{
        io::Write,
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };

    fn fixture(
        status: &str,
        body: String,
    ) -> (
        reqwest::Url,
        thread::JoinHandle<(String, serde_json::Value)>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let server =
            reqwest::Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        listener.set_nonblocking(true).unwrap();
        let status = status.to_owned();
        let task = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => panic!("fixture accept failed: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let header_end = loop {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() <= 8192);
                if request.ends_with(b"\r\n\r\n") {
                    break request.len();
                }
            };
            let header = String::from_utf8(request).unwrap();
            let length: usize = header
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse().unwrap())
                })
                .unwrap();
            assert!(length < 4096 && header_end < 8192);
            let mut request = vec![0; length];
            stream.read_exact(&mut request).unwrap();
            let request = serde_json::from_slice(&request).unwrap();
            write!(stream,"HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nLocation: /must-not-follow\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            (header.lines().next().unwrap().to_owned(), request)
        });
        (server, task)
    }
    #[test]
    fn actual_http_is_bounded_rejects_refusal_and_delivers_only_bound_authorization() {
        let http = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let key = SigningKey::from_bytes(&[84; 32]);
        let machine = uuid::Uuid::new_v4().to_string();
        let instance = uuid::Uuid::new_v4().to_string();
        let lease = uuid::Uuid::new_v4().to_string();
        for (status, body, success) in [
            (
                "200 OK",
                serde_json::json!({"leaseId":lease}).to_string(),
                true,
            ),
            (
                "403 Forbidden",
                serde_json::json!({"leaseId":lease}).to_string(),
                false,
            ),
            (
                "302 Found",
                serde_json::json!({"leaseId":lease}).to_string(),
                false,
            ),
            ("200 OK", " ".repeat(4097), false),
        ] {
            let (server, task) = fixture(status, body);
            let client = LeaseClient {
                http: &http,
                server: &server,
                key: &key,
                machine: &machine,
                instance: &instance,
                console: 3,
            };
            assert_eq!(client.discover().is_ok(), success);
            let (path, proof) = task.join().unwrap();
            assert_eq!(path, "POST /api/signin/pending HTTP/1.1");
            let message = format!(
                "beacon-remote:signin-pending:v1\n{machine}\n{}\n{}\n{instance}\n3",
                proof["timestamp"],
                proof["nonce"].as_str().unwrap()
            );
            key.verifying_key()
                .verify(
                    message.as_bytes(),
                    &Signature::from_slice(
                        &STANDARD
                            .decode(proof["signature"].as_str().unwrap())
                            .unwrap(),
                    )
                    .unwrap(),
                )
                .unwrap();
        }
        let body = serde_json::json!({"scope":"windows:sign-in","id":lease,"instanceId":instance,
            "consoleSessionId":3,"remainingMillis":15000,"controller":"fixture@example.test",
            "files":false,"clipboard":false,"audio":false,"recording":false,"automation":false})
        .to_string();
        let (server, task) = fixture("200 OK", body);
        let before = signin_scope::tick();
        let client = LeaseClient {
            http: &http,
            server: &server,
            key: &key,
            machine: &machine,
            instance: &instance,
            console: 3,
        };
        let SignInMessage::Authorization {
            lease_id,
            instance_id,
            console_session_id,
            expires_at_tick,
            ..
        } = client.authorize(&lease).unwrap()
        else {
            panic!("wrong message");
        };
        assert_eq!(
            (lease_id, instance_id, console_session_id),
            (lease.clone(), instance.clone(), 3)
        );
        assert!(
            expires_at_tick > before
                && expires_at_tick
                    <= signin_scope::tick() + 15_000 * signin_scope::TICKS_PER_MILLISECOND
        );
        let (path, proof) = task.join().unwrap();
        assert_eq!(path, "POST /api/signin/authorize HTTP/1.1");
        let message = format!(
            "beacon-remote:signin-lease:v1\n{machine}\n{}\n{}\n{lease}\n{instance}\n3",
            proof["timestamp"],
            proof["nonce"].as_str().unwrap()
        );
        key.verifying_key()
            .verify(
                message.as_bytes(),
                &Signature::from_slice(
                    &STANDARD
                        .decode(proof["signature"].as_str().unwrap())
                        .unwrap(),
                )
                .unwrap(),
            )
            .unwrap();
    }
    #[test]
    fn discovery_requires_explicit_bounded_strict_canonical_id() {
        assert_eq!(discovery(br#"{"leaseId":null}"#).unwrap(), None);
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            discovery(serde_json::json!({"leaseId":id}).to_string().as_bytes()).unwrap(),
            Some(id)
        );
        for body in [
            br#"{}"#.as_slice(),
            br#"{"leaseId":null,"leaseId":null}"#,
            br#"{"leaseId":null,"files":true}"#,
            br#"{"leaseId":0}"#,
            br#"{"leaseId":"00000000-0000-0000-0000-000000000000"}"#,
            br#"{"leaseId":"bad"}"#,
        ] {
            assert!(discovery(body).is_err());
        }
        assert!(discovery(&vec![b' '; 4097]).is_err());
    }
    #[test]
    fn proofs_bind_distinct_domains_process_console_and_fresh_nonce() {
        let key = SigningKey::from_bytes(&[73; 32]);
        let http = reqwest::blocking::Client::new();
        let server = reqwest::Url::parse("https://remote.example.test").unwrap();
        let client = LeaseClient {
            http: &http,
            server: &server,
            key: &key,
            machine: "machine",
            instance: "instance",
            console: 7,
        };
        let pending = client.proof(None).unwrap();
        let lease = uuid::Uuid::new_v4().to_string();
        let grant = client.proof(Some(&lease)).unwrap();
        assert_ne!(pending["nonce"], grant["nonce"]);
        assert!(pending.get("leaseId").is_none());
        for (body, domain, field) in [
            (&pending, "pending", String::new()),
            (&grant, "lease", format!("{lease}\n")),
        ] {
            let message = format!(
                "beacon-remote:signin-{domain}:v1\nmachine\n{}\n{}\n{field}instance\n7",
                body["timestamp"],
                body["nonce"].as_str().unwrap()
            );
            let bytes = STANDARD
                .decode(body["signature"].as_str().unwrap())
                .unwrap();
            let signature = Signature::from_slice(&bytes).unwrap();
            key.verifying_key()
                .verify(message.as_bytes(), &signature)
                .unwrap();
            assert!(key
                .verifying_key()
                .verify(
                    message.replace("instance\n7", "instance\n8").as_bytes(),
                    &signature
                )
                .is_err());
            assert!(key
                .verifying_key()
                .verify(message.replace("signin-", "boot-").as_bytes(), &signature)
                .is_err());
        }
    }
}
