//! Temporary support (ADR 0038): the support client redeems a technician's one-use link, becomes a temporary computer
//! with its own identity under a private folder, and removes everything it created when support ends.
//!
//! All state lives under one root, `%LOCALAPPDATA%\BeaconSupport\<id>`, and the client runs with `LOCALAPPDATA`
//! pointing at `<root>\data`, so it can never read or replace the identity of a permanently installed Beacon Remote.
use super::*;
use std::path::Path;

pub const DEFAULT_SERVER: &str = "https://remote.builtbysai.com";
const RUN_ONCE: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
const RUN_ONCE_VALUE: &str = crate::support_supervisor::RUN_ONCE_VALUE;

/// The server a link belongs to. A different server may be named only for local testing.
pub fn server() -> String {
    std::env::var("BEACON_SERVER").unwrap_or_else(|_| DEFAULT_SERVER.into())
}

/// The folder this temporary client owns, handed in by the program that started it.
pub fn root() -> Option<PathBuf> {
    std::env::var_os("BEACON_SUPPORT_ROOT").map(PathBuf::from)
}

#[derive(Deserialize, Serialize, Default)]
struct Record {
    /// When this temporary access ends on its own, even with no network.
    deadline_millis: u64,
    technician: String,
    control: bool,
    /// Whether the programs are removed with the credentials when support ends.
    remove_programs: bool,
    /// Support was ended on purpose (not a crash or a restart), so it must not resume.
    #[serde(default)]
    ended: bool,
}

fn record_path() -> Option<PathBuf> {
    Some(root()?.join("support.json"))
}
fn read_record() -> Option<Record> {
    record_at(&root()?)
}
fn record_at(root: &Path) -> Option<Record> {
    serde_json::from_slice(&fs::read(root.join("support.json")).ok()?).ok()
}

/// Marks support as ended on purpose, so a watching supervisor cleans up instead of restarting it.
pub fn mark_ended() {
    if let Some(mut record) = read_record() {
        record.ended = true;
        let _ = write_record(&record);
    }
}

/// Whether this process's support folder holds a session that may continue (see `resumable`).
pub fn can_resume() -> bool {
    root().is_some_and(|root| resumable(&root))
}

/// Whether the folder holds a claimed, unfinished, unexpired support session that may continue after an interruption.
pub(crate) fn resumable(root: &Path) -> bool {
    let Some(record) = record_at(root) else {
        return false;
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(u64::MAX);
    !record.ended
        && record.deadline_millis > now
        && root
            .join("data")
            .join("BeaconRemote")
            .join("identity.dpapi")
            .is_file()
}
fn write_record(record: &Record) -> Result<(), HostError> {
    let path = record_path().ok_or("Not running as temporary support")?;
    fs::write(path, serde_json::to_vec(record)?)?;
    Ok(())
}

/// Who is asking, shown to the person before anything is sent from this computer.
pub struct Preview {
    pub technician: String,
    pub control: bool,
    pub label: Option<String>,
}

pub fn preview(token: &str) -> Result<Preview, HostError> {
    let server = validate_server(&server())?;
    let response = client()?
        .post(server.join("/api/support-invite/preview")?)
        .json(&serde_json::json!({ "token": token }))
        .send()?;
    if !response.status().is_success() {
        return Err("This support link has expired or was already used.".into());
    }
    let body: serde_json::Value = response.json()?;
    Ok(Preview {
        technician: body["technician"].as_str().unwrap_or("").to_owned(),
        control: body["capability"] == "desktop:control",
        label: body["label"].as_str().map(str::to_owned),
    })
}

/// Redeems the link. The server answers once; a second computer, or a second try, is refused.
pub fn claim(token: &str, name: &str) -> Result<(), HostError> {
    let server = validate_server(&server())?;
    let path = state_path()?;
    if path.exists() {
        return Err("This temporary support folder already has an identity".into());
    }
    let key = SigningKey::generate(&mut rand::rng());
    let response = client()?
        .post(server.join("/api/agent/support-claim")?)
        .json(&serde_json::json!({
            "version": 1, "token": token, "name": name,
            "publicKey": STANDARD.encode(key.verifying_key().as_bytes()),
        }))
        .send()?;
    if !response.status().is_success() {
        return Err("This support link has expired or was already used.".into());
    }
    let body: serde_json::Value = response.json()?;
    let machine_id = body["machineId"]
        .as_str()
        .ok_or("Unexpected response")?
        .to_owned();
    uuid::Uuid::parse_str(&machine_id)?;
    store_identity(&server, machine_id, &key)?;
    write_record(&Record {
        deadline_millis: body["expiresAtMillis"].as_u64().unwrap_or(0),
        technician: body["technician"].as_str().unwrap_or("").to_owned(),
        control: body["capability"] == "desktop:control",
        remove_programs: true,
        ended: false,
    })
}

pub fn technician() -> String {
    read_record().map(|r| r.technician).unwrap_or_default()
}

/// One line of the conversation with the technician.
#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub id: u64,
    /// "technician", "person" (this computer's own user) or "system".
    pub sender: String,
    pub body: String,
}

/// Sends an optional message and fetches what is new after `since`, in one signed request. The reply also says who
/// the technician is now, which is remembered for the window (a handoff changes it).
pub fn chat_exchange(since: u64, text: Option<&str>) -> Result<Vec<ChatMessage>, HostError> {
    use sha2::{Digest, Sha256};
    let identity = load_identity()?;
    let server = validate_server(&identity.server)?;
    let key = SigningKey::from_bytes(&identity.secret_key);
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let nonce = uuid::Uuid::new_v4().to_string();
    let digest: String = Sha256::digest(text.unwrap_or("").as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let digest = if text.is_some() {
        digest
    } else {
        String::new()
    };
    let message = format!(
        "beacon-remote:chat:v1\n{}\n{}\n{}\n{}\n{}",
        identity.machine_id, timestamp, nonce, since, digest
    );
    let mut body = serde_json::json!({
        "version": 1, "machineId": identity.machine_id, "timestamp": timestamp, "nonce": nonce,
        "since": since, "signature": STANDARD.encode(key.sign(message.as_bytes()).to_bytes()),
    });
    if let Some(text) = text {
        body["text"] = text.into();
    }
    let response = client()?
        .post(server.join("/api/agent/chat")?)
        .json(&body)
        .send()?;
    if !response.status().is_success() {
        return Err("The chat could not be reached".into());
    }
    let reply: serde_json::Value = response.json()?;
    if let (Some(technician), Some(mut record)) = (reply["technician"].as_str(), read_record()) {
        if record.technician != technician {
            record.technician = technician.to_owned();
            let _ = write_record(&record);
        }
    }
    Ok(reply["messages"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|item| {
                    Some(ChatMessage {
                        id: item["id"].as_u64()?,
                        sender: item["sender"].as_str()?.to_owned(),
                        body: item["body"].as_str()?.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

/// The time this temporary access ends by itself, in milliseconds since 1970. None until a link is redeemed.
pub fn deadline() -> Option<u64> {
    read_record()
        .map(|r| r.deadline_millis)
        .filter(|&millis| millis > 0)
}

pub fn expired() -> bool {
    deadline().is_some_and(|millis| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|now| now.as_millis() as u64 >= millis)
            .unwrap_or(false)
    })
}

pub fn remove_wanted() -> bool {
    read_record().is_none_or(|r| r.remove_programs)
}

pub fn set_remove_wanted(on: bool) {
    if let Some(mut record) = read_record() {
        record.remove_programs = on;
        let _ = write_record(&record);
    }
}

/// Tells the server support is over, signed with this client's temporary key, so the computer is revoked now.
/// Best effort: if the network is down the time limit and the technician side still end it.
pub fn end() {
    let Ok(identity) = load_identity() else {
        return;
    };
    let Ok(server) = validate_server(&identity.server) else {
        return;
    };
    let key = SigningKey::from_bytes(&identity.secret_key);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let nonce = uuid::Uuid::new_v4().to_string();
    let message = format!(
        "beacon-remote:support-end:v1\n{}\n{}\n{}",
        identity.machine_id, timestamp, nonce
    );
    if let (Ok(client), Ok(url)) = (client(), server.join("/api/agent/support-end")) {
        let _ = client
            .post(url)
            .json(&serde_json::json!({
                "version": 1, "machineId": identity.machine_id, "timestamp": timestamp,
                "nonce": nonce, "signature": STANDARD.encode(key.sign(message.as_bytes()).to_bytes()),
            }))
            .send();
    }
}

/// Only a folder this program makes is ever removed: `<local app data>\BeaconSupport\<16 hex digits>`.
pub fn is_support_root(root: &Path) -> bool {
    let real = std::env::var_os("BEACON_REAL_LOCALAPPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from);
    let (Some(real), Some(name), Some(parent)) = (real, root.file_name(), root.parent()) else {
        return false;
    };
    let name = name.to_string_lossy();
    name.len() == 16
        && name.bytes().all(|b| b.is_ascii_hexdigit())
        && parent.file_name().is_some_and(|n| n == "BeaconSupport")
        && parent.parent().is_some_and(|p| p == real)
}

/// The downloaded program is removed with the rest, but only if it still has the name the link gave it.
fn is_support_download(path: &Path) -> bool {
    path.file_name().is_some_and(|name| {
        let name = name.to_string_lossy();
        name.strip_prefix("BeaconSupport-")
            .and_then(|rest| rest.strip_suffix(".exe"))
            .is_some_and(|token| {
                token.len() == 32
                    && token
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            })
    })
}

#[cfg(windows)]
fn forget_run_once() {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY_CURRENT_USER, KEY_SET_VALUE,
    };
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() };
    unsafe {
        let mut key = std::ptr::null_mut();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            wide(RUN_ONCE).as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut key,
        ) == 0
        {
            RegDeleteValueW(key, wide(RUN_ONCE_VALUE).as_ptr());
            RegCloseKey(key);
        }
    }
}
#[cfg(not(windows))]
fn forget_run_once() {}

/// Removes what this temporary client created. The credentials always go; the programs and the downloaded file go
/// too unless the person chose to keep them. Removal runs in a short detached command once this process exits.
pub fn cleanup(root: &Path, download: Option<&Path>) -> Result<(), HostError> {
    if !is_support_root(root) {
        return Err("Not a Beacon temporary support folder".into());
    }
    forget_run_once();
    let remove_programs = fs::read(root.join("support.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Record>(&bytes).ok())
        .is_none_or(|record| record.remove_programs);
    // The identity and everything private to this session, whatever else is kept.
    let _ = fs::remove_dir_all(root.join("data"));
    if !remove_programs {
        return Ok(());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let command = format!(
            "for /l %i in (1,1,15) do @(if exist \"{root}\" (rmdir /s /q \"{root}\" 2>nul & ping -n 2 127.0.0.1 >nul))",
            root = root.display()
        );
        let mut tail = String::new();
        if let Some(path) = download.filter(|path| is_support_download(path)) {
            tail.push_str(&format!(" & del /f /q \"{}\"", path.display()));
        }
        if let Some(parent) = root.parent() {
            tail.push_str(&format!(" & rmdir \"{}\" 2>nul", parent.display()));
        }
        // Not inside the folder being removed: a process whose working directory is there would keep it alive.
        let _ = std::process::Command::new("cmd")
            .current_dir(std::env::temp_dir())
            .raw_arg(format!("/d /c ping -n 3 127.0.0.1 >nul & {command}{tail}"))
            .creation_flags(0x0800_0000)
            .spawn();
    }
    #[cfg(not(windows))]
    let _ = download;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_our_own_folders_and_downloads_are_removable() {
        std::env::set_var("BEACON_REAL_LOCALAPPDATA", r"C:\Users\x\AppData\Local");
        assert!(is_support_root(Path::new(
            r"C:\Users\x\AppData\Local\BeaconSupport\0123456789abcdef"
        )));
        for bad in [
            r"C:\Users\x\AppData\Local\BeaconSupport",
            r"C:\Users\x\AppData\Local\BeaconSupport\0123",
            r"C:\Users\x\AppData\Local\BeaconSupport\0123456789abcdeg",
            r"C:\Users\x\AppData\Local\Other\0123456789abcdef",
            r"C:\Users\x\Documents\BeaconSupport\0123456789abcdef",
            r"C:\Users\x\AppData\Local",
        ] {
            assert!(!is_support_root(Path::new(bad)), "{bad}");
        }
        let token = "A".repeat(32);
        assert!(is_support_download(Path::new(&format!(
            r"C:\Users\x\Downloads\BeaconSupport-{token}.exe"
        ))));
        assert!(!is_support_download(Path::new(
            r"C:\Users\x\Downloads\BeaconSupport-short.exe"
        )));
        assert!(!is_support_download(Path::new(
            r"C:\Users\x\Downloads\notes.exe"
        )));
    }
}
