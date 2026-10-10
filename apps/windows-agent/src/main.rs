mod credentials;
mod sessions;

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroize;

#[derive(Deserialize, Serialize)]
struct Identity {
    machine_id: String,
    server: String,
    secret_key: [u8; 32],
}
impl Drop for Identity {
    fn drop(&mut self) {
        self.secret_key.zeroize();
    }
}

fn state_path() -> io::Result<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| io::Error::other("LOCALAPPDATA required"))?;
    Ok(PathBuf::from(local)
        .join("BeaconRemote")
        .join("identity.dpapi"))
}

fn validate_server(server: &str) -> Result<reqwest::Url, Box<dyn std::error::Error>> {
    let url = reqwest::Url::parse(server)?;
    let local = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Server must be an HTTPS origin (HTTP allowed only on loopback)".into());
    }
    Ok(url)
}

fn prompt(label: &str) -> io::Result<String> {
    print!("{label}: ");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line)?;
    Ok(line.trim().to_owned())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if !cfg!(windows) {
        return Err("Beacon Remote agent requires Windows".into());
    }
    let command = std::env::args().nth(1).unwrap_or_else(|| "help".into());
    if command == "help" {
        println!("Beacon Remote development agent\n  pair: enroll using an interactive one-use code\n  run: visible signed presence (Ctrl+C to stop)\n  forget: remove this user's local identity after server-side revocation\nNo screen capture, input control, service, or startup persistence is installed.");
        return Ok(());
    }
    let path = state_path()?;
    if command == "forget" {
        fs::remove_file(&path)?;
        println!("Local identity removed. Revoke the computer in Beacon Remote to disable its server identity.");
        return Ok(());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    if command == "pair" {
        if path.exists() {
            return Err(
                "Already paired; revoke and forget the old identity before pairing again".into(),
            );
        }
        let server = validate_server(&prompt("Beacon Remote server origin")?)?;
        let name = prompt("Computer name")?;
        let mut code = prompt("Pairing code")?;
        let key = SigningKey::generate(&mut OsRng);
        let response = client.post(server.join("/api/agent/enroll")?).json(&serde_json::json!({
            "version": 1, "code": code, "name": name, "publicKey": STANDARD.encode(key.verifying_key().as_bytes()),
        })).send()?;
        code.zeroize();
        if !response.status().is_success() {
            return Err("Enrollment rejected; obtain a new code and try again".into());
        }
        let body: serde_json::Value = response.json()?;
        let machine_id = body["machineId"]
            .as_str()
            .ok_or("Enrollment response missing identity")?
            .to_owned();
        uuid::Uuid::parse_str(&machine_id)?;
        let identity = Identity {
            machine_id,
            server: server.to_string(),
            secret_key: key.to_bytes(),
        };
        let mut plaintext = serde_json::to_vec(&identity)?;
        let protected_result = credentials::protect(&plaintext);
        plaintext.zeroize();
        let protected = protected_result?;
        fs::create_dir_all(path.parent().ok_or("State directory missing")?)?;
        // create_new prevents silently replacing another running instance's identity.
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        file.write_all(&protected)?;
        file.sync_all()?;
        println!("Paired. Run `beacon-remote-agent run` to report presence.");
        return Ok(());
    }
    if command != "run" {
        return Err("Unknown command; use help".into());
    }
    let mut decrypted = credentials::unprotect(&fs::read(&path)?)?;
    let identity_result = serde_json::from_slice::<Identity>(&decrypted);
    decrypted.zeroize();
    let identity = identity_result?;
    let server = validate_server(&identity.server)?;
    let key = SigningKey::from_bytes(&identity.secret_key);
    let mut failures: u32 = 0;
    let mut helpers = sessions::Helpers::default();
    println!("Beacon Remote is reporting presence. No desktop capture or remote control is active. Ctrl+C stops this process.");
    loop {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        let nonce = uuid::Uuid::new_v4().to_string();
        let message = format!(
            "beacon-remote:heartbeat:v1\n{}\n{}\n{}",
            identity.machine_id, timestamp, nonce
        );
        let response = client.post(server.join("/api/agent/heartbeat")?).json(&serde_json::json!({
            "version": 1, "machineId": identity.machine_id, "timestamp": timestamp,
            "nonce": nonce, "signature": STANDARD.encode(key.sign(message.as_bytes()).to_bytes()),
        })).send();
        match response {
            Ok(response) if response.status().is_success() => {
                helpers.update(response.json()?, &identity.server)?;
                if failures > 0 {
                    println!("Connection restored.");
                }
                failures = 0;
                thread::sleep(Duration::from_secs(15));
            }
            Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
                return Err("Identity rejected or clock out of sync. Presence stopped; check revocation and Windows time.".into());
            }
            _ => {
                failures = failures.saturating_add(1);
                let base = 2_u64.pow(failures.min(6));
                let jitter = u64::from(rand::random::<u16>()) % 1000;
                println!("Connection unavailable; retrying.");
                thread::sleep(Duration::from_millis(base * 1000 + jitter));
            }
        }
    }
}
