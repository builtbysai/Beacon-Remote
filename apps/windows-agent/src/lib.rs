mod credentials;
#[cfg(windows)]
mod helper_lifetime;
mod sessions;

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::SyncSender,
        Arc,
    },
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

/// This computer's own access setting (ADR 0021). It is raised only here, by the person at the
/// computer, and a lower setting on the server always wins. Unreadable or missing means attended.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct LocalAccess {
    pub trusted: bool,
    pub allow_control: bool,
}

fn access_path() -> io::Result<PathBuf> {
    Ok(state_path()?.with_file_name("access.dpapi"))
}

pub fn local_access() -> LocalAccess {
    let read = || -> Result<LocalAccess, HostError> {
        let mut plaintext = credentials::unprotect(&fs::read(access_path()?)?)?;
        let access = serde_json::from_slice::<LocalAccess>(&plaintext);
        plaintext.zeroize();
        let access = access?;
        // Control is never trusted on its own.
        Ok(LocalAccess {
            trusted: access.trusted,
            allow_control: access.trusted && access.allow_control,
        })
    };
    read().unwrap_or_default()
}

fn save_local_access(access: LocalAccess) -> Result<(), HostError> {
    let path = access_path()?;
    let protected = credentials::protect(&serde_json::to_vec(&access)?)?;
    fs::create_dir_all(path.parent().ok_or("State directory missing")?)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, protected)?;
    fs::rename(temporary, path)?;
    Ok(())
}

fn load_identity() -> Result<Identity, HostError> {
    let mut decrypted = credentials::unprotect(&fs::read(state_path()?)?)?;
    let identity = serde_json::from_slice::<Identity>(&decrypted);
    decrypted.zeroize();
    Ok(identity?)
}

fn post_access(
    client: &reqwest::blocking::Client,
    identity: &Identity,
    access: LocalAccess,
) -> Result<(), HostError> {
    let server = validate_server(&identity.server)?;
    let key = SigningKey::from_bytes(&identity.secret_key);
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let nonce = uuid::Uuid::new_v4().to_string();
    let mode = if access.trusted {
        "trusted"
    } else {
        "attended"
    };
    let message = format!(
        "beacon-remote:access:v1\n{}\n{}\n{}\n{}\n{}",
        identity.machine_id, timestamp, nonce, mode, access.allow_control
    );
    let response = client
        .post(server.join("/api/agent/access")?)
        .json(&serde_json::json!({
            "version": 1, "machineId": identity.machine_id, "timestamp": timestamp,
            "nonce": nonce, "mode": mode, "allowControl": access.allow_control,
            "signature": STANDARD.encode(key.sign(message.as_bytes()).to_bytes()),
        }))
        .send()?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err("The server did not accept the access change".into())
    }
}

/// Raises or lowers this computer's access. Lowering takes effect locally at once, whether or not
/// the server can be reached (the next presence report repeats it); raising needs the server.
pub fn set_access(trusted: bool, allow_control: bool) -> Result<(), HostError> {
    let access = LocalAccess {
        trusted,
        allow_control: trusted && allow_control,
    };
    let current = local_access();
    let raising =
        (access.trusted && !current.trusted) || (access.allow_control && !current.allow_control);
    let identity = load_identity()?;
    let client = client()?;
    if raising {
        post_access(&client, &identity, access)?;
        save_local_access(access)?;
    } else {
        save_local_access(access)?;
        let _ = post_access(&client, &identity, access);
    }
    Ok(())
}

// The lower of this computer's setting and the server's wins on both sides.
fn reconcile_access(
    client: &reqwest::blocking::Client,
    identity: &Identity,
    server_trusted: bool,
    server_control: bool,
) {
    let local = local_access();
    let target = LocalAccess {
        trusted: local.trusted && server_trusted,
        allow_control: local.allow_control && server_trusted && server_control,
    };
    if target != local {
        let _ = save_local_access(target);
    }
    // The computer lowered itself (or the file was reset) while the server still allows more.
    if server_trusted && (!target.trusted || (server_control && !target.allow_control)) {
        let _ = post_access(client, identity, target);
    }
}

fn validate_server(server: &str) -> Result<reqwest::Url, HostError> {
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

pub type HostError = Box<dyn std::error::Error + Send + Sync>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostStatus {
    Connecting,
    Online,
    Retrying,
    Stopped,
    Rejected,
}
/// The displays attached to this computer, in physical pixels, for the viewer to choose from.
/// The session helper re-reads the display it is asked for, so this is only a selector.
#[cfg(windows)]
fn local_displays() -> Vec<serde_json::Value> {
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, EnumDisplaySettingsW, GetMonitorInfoW, DEVMODEW,
        ENUM_CURRENT_SETTINGS, HDC, HMONITOR, MONITORINFOEXW,
    };
    unsafe extern "system" fn collect(
        monitor: HMONITOR,
        _: HDC,
        _: *mut windows_sys::Win32::Foundation::RECT,
        found: isize,
    ) -> i32 {
        let found = &mut *(found as *mut Vec<serde_json::Value>);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(monitor, std::ptr::addr_of_mut!(info).cast()) == 0 {
            return 1;
        }
        let mut mode: DEVMODEW = std::mem::zeroed();
        mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(info.szDevice.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) == 0 {
            return 1;
        }
        let length = info.szDevice.iter().position(|&c| c == 0).unwrap_or(0);
        found.push(serde_json::json!({
            "id": String::from_utf16_lossy(&info.szDevice[..length]),
            "width": mode.dmPelsWidth,
            "height": mode.dmPelsHeight,
            "primary": info.monitorInfo.dwFlags & 1 != 0,
        }));
        1
    }
    let mut found: Vec<serde_json::Value> = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(collect),
            std::ptr::addr_of_mut!(found) as isize,
        );
    }
    found.truncate(8);
    found
}
#[cfg(not(windows))]
fn local_displays() -> Vec<serde_json::Value> {
    Vec::new()
}

pub fn is_paired() -> bool {
    state_path().is_ok_and(|path| path.is_file())
}

pub fn pair(server: &str, name: &str, code: String) -> Result<(), HostError> {
    let mut code = zeroize::Zeroizing::new(code);
    let path = state_path()?;
    let client = client()?;
    if path.exists() {
        return Err(
            "Already paired; revoke and forget the old identity before pairing again".into(),
        );
    }
    let server = validate_server(server)?;
    if name.trim().is_empty() || name.chars().count() > 80 || code.len() > 256 {
        return Err("Enter a computer name and a valid pairing code".into());
    }
    let key = SigningKey::generate(&mut OsRng);
    let response = client.post(server.join("/api/agent/enroll")?).json(&serde_json::json!({
            "version": 1, "code": &*code, "name": name, "publicKey": STANDARD.encode(key.verifying_key().as_bytes()),
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
    Ok(())
}
pub fn run(cancel: Arc<AtomicBool>, status: SyncSender<HostStatus>) -> Result<(), HostError> {
    let _ = status.try_send(HostStatus::Connecting);
    let client = client()?;
    let path = state_path()?;
    #[cfg(windows)]
    let _presence_lock = {
        use std::os::windows::fs::OpenOptionsExt;
        // A Windows sharing lock releases on crash; its empty file holds no
        // credentials. GUI and CLI cannot report presence from the same identity
        // concurrently, and no stale PID/lockfile needs manual deletion.
        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(0)
            .open(path.with_file_name("presence.lock"))
            .map_err(|_| "This host is already running, or its state directory is unavailable")?
    };
    let identity = load_identity()?;
    let server = validate_server(&identity.server)?;
    let key = SigningKey::from_bytes(&identity.secret_key);
    let mut failures: u32 = 0;
    let mut helpers = sessions::Helpers::new(cancel.clone());
    let mut handled_request: Option<String> = None;
    println!("Beacon Remote is reporting presence. No desktop capture or remote control is active. Ctrl+C stops this process.");
    while !cancel.load(Ordering::Acquire) {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        let nonce = uuid::Uuid::new_v4().to_string();
        let message = format!(
            "beacon-remote:heartbeat:v1\n{}\n{}\n{}",
            identity.machine_id, timestamp, nonce
        );
        let mut query = vec![("wait", "1")];
        if let Some(id) = handled_request.as_deref() {
            query.push(("handled", id));
        }
        let response = client.post(server.join("/api/agent/heartbeat")?)
        .timeout(Duration::from_secs(25)).query(&query).json(&serde_json::json!({
            "version": 1, "machineId": identity.machine_id, "timestamp": timestamp,
            "nonce": nonce, "signature": STANDARD.encode(key.sign(message.as_bytes()).to_bytes()),
            "displays": local_displays(),
        })).send();
        match response {
            Ok(response) if response.status().is_success() => {
                let body: serde_json::Value = response.json()?;
                let mut poll_after = body["pollAfterMillis"]
                    .as_u64()
                    .filter(|delay| matches!(delay, 0 | 15000))
                    .unwrap_or(15000);
                let request_id = body["sessions"]
                    .as_array()
                    .and_then(|grants| grants.first())
                    .and_then(|grant| grant["id"].as_str())
                    .map(str::to_owned);
                reconcile_access(
                    &client,
                    &identity,
                    body["access"]["mode"] == "trusted",
                    body["access"]["allowControl"] == true,
                );
                helpers.update(body, &identity.server, local_access())?;
                if let Some(id) = request_id {
                    if helpers.handled(&id) {
                        handled_request = Some(id);
                    } else {
                        // A previous helper may still be closing after local Stop.
                        // Keep the new request pending and retry without a busy loop.
                        poll_after = 1000;
                    }
                }
                if failures > 0 {
                    println!("Connection restored.");
                }
                failures = 0;
                let _ = status.try_send(HostStatus::Online);
                pause(&cancel, Duration::from_millis(poll_after));
            }
            Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
                let _ = status.try_send(HostStatus::Rejected);
                return Err("Identity rejected or clock out of sync. Presence stopped; check revocation and Windows time.".into());
            }
            _ => {
                failures = failures.saturating_add(1);
                let base = 2_u64.pow(failures.min(6));
                let jitter = u64::from(rand::random::<u16>()) % 1000;
                println!("Connection unavailable; retrying.");
                let _ = status.try_send(HostStatus::Retrying);
                pause(&cancel, Duration::from_millis(base * 1000 + jitter));
            }
        }
    }
    drop(helpers);
    let _ = status.try_send(HostStatus::Stopped);
    Ok(())
}

fn client() -> Result<reqwest::blocking::Client, HostError> {
    Ok(reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}
fn pause(cancel: &AtomicBool, duration: Duration) {
    let end = std::time::Instant::now() + duration;
    while !cancel.load(Ordering::Acquire) && std::time::Instant::now() < end {
        thread::sleep(
            Duration::from_millis(50).min(end.saturating_duration_since(std::time::Instant::now())),
        );
    }
}

pub fn cli() -> Result<(), HostError> {
    let command = std::env::args().nth(1).unwrap_or_else(|| "help".into());
    match command.as_str() {
        "pair" => {
            pair(
                &prompt("Beacon Remote server origin")?,
                &prompt("Computer name")?,
                prompt("Pairing code")?,
            )?;
            println!("Paired. Open Beacon Remote Host or run the agent.");
            Ok(())
        }
        "run" => {
            let (status, _receiver) = std::sync::mpsc::sync_channel(8);
            run(Arc::new(AtomicBool::new(false)), status)
        }
        "access" => {
            let mode = std::env::args().nth(2).unwrap_or_else(|| "status".into());
            let control = std::env::args().any(|argument| argument == "--control");
            match mode.as_str() {
                "trusted" => {
                    set_access(true, control)?;
                    println!(
                        "Trusted personal access is on{}. Sessions from your signed-in account connect without a prompt; Stop, sign-out and revocation still end them.",
                        if control { ", including remote control" } else { " for viewing" }
                    );
                }
                "attended" => {
                    set_access(false, false)?;
                    println!("Attended access: every connection needs your Allow.");
                }
                _ => {
                    let access = local_access();
                    println!(
                        "{}",
                        match (access.trusted, access.allow_control) {
                            (false, _) => "attended",
                            (true, false) => "trusted, viewing only",
                            (true, true) => "trusted, viewing and control",
                        }
                    );
                }
            }
            Ok(())
        }
        "forget" => {
            fs::remove_file(state_path()?)?;
            println!("Local identity removed. Revoke the computer in Beacon Remote to disable its server identity.");
            Ok(())
        }
        "help" => {
            println!("Beacon Remote development agent\n  pair: enroll using an interactive one-use code\n  run: signed presence\n  access [trusted [--control]|attended|status]: this computer's own access setting\n  forget: remove this user local identity after server-side revocation\nUse beacon-remote-host for the native attended host window. No Windows service or startup persistence is installed.");
            Ok(())
        }
        _ => Err("Unknown command; use help".into()),
    }
}
