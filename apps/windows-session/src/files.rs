//! Receiving a file from the person helping, safely (ADR 0031).
//!
//! The viewer proposes a name and a size; this computer decides where the bytes go. Nothing is written
//! outside one folder, nothing is overwritten, a half-received file never has its final name, and the
//! finished file is marked as coming from the internet so Windows warns before it is run.
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

/// Largest single file, and the most one session may receive.
pub const MAX_FILE: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_SESSION: u64 = 4 * 1024 * 1024 * 1024;
/// Largest binary chunk the viewer may send.
pub const MAX_CHUNK: usize = 64 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    TooLarge,
    SessionFull,
    Busy,
    Name,
    Disk,
}
impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Self::TooLarge => "too-large",
            Self::SessionFull => "session-full",
            Self::Busy => "busy",
            Self::Name => "name",
            Self::Disk => "disk",
        }
    }
}

/// A file name that is safe to create on Windows: one path component, no reserved characters or device
/// names, no trailing dots or spaces, a bounded length with the extension kept.
pub fn safe_name(proposed: &str) -> Option<String> {
    let last = proposed.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned
        .trim_matches(|c: char| c == ' ' || c == '.')
        .to_string();
    if cleaned.is_empty() {
        return None;
    }
    let (stem, extension) = match cleaned.rfind('.') {
        Some(at) if at > 0 => (&cleaned[..at], &cleaned[at..]),
        _ => (cleaned.as_str(), ""),
    };
    let extension: String = extension.chars().take(16).collect();
    let stem: String = stem.chars().take(120).collect();
    let stem = stem.trim_end_matches([' ', '.']).to_string();
    if stem.is_empty() {
        return None;
    }
    let device = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && device.as_bytes()[3].is_ascii_digit()
            && device.as_bytes()[3] != b'0');
    Some(if reserved {
        format!("_{stem}{extension}")
    } else {
        format!("{stem}{extension}")
    })
}

/// The partial file that goes with a final name.
fn part_of(target: &Path) -> PathBuf {
    target.with_file_name(format!(
        "{}.beaconpart",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
    ))
}

/// `name`, or `name (1)`, `name (2)`… the first that neither exists in `folder` nor is being received there
/// (a part kept for a reconnecting viewer reserves its name).
pub fn unique_path(folder: &Path, name: &str) -> PathBuf {
    let taken = |path: &Path| path.exists() || part_of(path).exists();
    let candidate = folder.join(name);
    if !taken(&candidate) {
        return candidate;
    }
    let (stem, extension) = match name.rfind('.') {
        Some(at) if at > 0 => (&name[..at], &name[at..]),
        _ => (name, ""),
    };
    (1..10_000)
        .map(|n| folder.join(format!("{stem} ({n}){extension}")))
        .find(|path| !taken(path))
        .unwrap_or_else(|| folder.join(format!("{stem} ({}){extension}", std::process::id())))
}

/// One incoming file. Bytes go to a `.beaconpart` file; `finish` checks length and hash, renames it to the
/// final name and marks it. Dropping an unfinished receiver deletes the partial file.
pub struct Incoming {
    part: PathBuf,
    target: PathBuf,
    file: Option<File>,
    expected: u64,
    written: u64,
    hasher: Sha256,
    done: bool,
    // Kept for a reconnecting viewer instead of being deleted (see `park`).
    parked: bool,
    // What identifies it for a later offer of the same file: where, the safe name, the announced size.
    key: (PathBuf, String, u64),
}

/// An interrupted incoming file that stays on disk, for this session only, so the same viewer can carry on from
/// where it stopped. Only held in this process's memory: a new session never sees it, and it is deleted when the
/// session ends, sharing is paused, or the person at this computer stops sharing.
struct Parked {
    key: (PathBuf, String, u64),
    part: PathBuf,
    target: PathBuf,
    written: u64,
}
static PARKED: std::sync::Mutex<Vec<Parked>> = std::sync::Mutex::new(Vec::new());
const MAX_PARKED: usize = 4;

/// Deletes every interrupted file kept for resuming.
pub fn discard_parked() {
    if let Ok(mut parked) = PARKED.lock() {
        for entry in parked.drain(..) {
            let _ = fs::remove_file(entry.part);
        }
    }
}

/// Deletes the interrupted copy of one file, when the viewer would rather start it again.
pub fn discard_matching(folder: &Path, proposed: &str, size: u64) {
    let Some(name) = safe_name(proposed) else {
        return;
    };
    if let Ok(mut parked) = PARKED.lock() {
        parked.retain(|entry| {
            let same = entry.key == (folder.to_path_buf(), name.clone(), size);
            if same {
                let _ = fs::remove_file(&entry.part);
            }
            !same
        });
    }
}

/// Removes `.beaconpart` files older than a day, left behind if a session ended abnormally.
pub fn sweep_stale(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > std::time::Duration::from_secs(24 * 3600));
        if old
            && path
                .extension()
                .is_some_and(|extension| extension == "beaconpart")
        {
            let _ = fs::remove_file(path);
        }
    }
}

impl Incoming {
    pub fn begin(folder: &Path, proposed: &str, size: u64) -> Result<Self, Refusal> {
        if size == 0 || size > MAX_FILE {
            return Err(Refusal::TooLarge);
        }
        let name = safe_name(proposed).ok_or(Refusal::Name)?;
        fs::create_dir_all(folder).map_err(|_| Refusal::Disk)?;
        let target = unique_path(folder, &name);
        let part = target.with_file_name(format!(
            "{}.beaconpart",
            target
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
        ));
        // create_new: never reuse or overwrite anything that is already there.
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)
            .map_err(|_| Refusal::Disk)?;
        Ok(Self {
            part,
            target,
            file: Some(file),
            expected: size,
            written: 0,
            hasher: Sha256::new(),
            done: false,
            parked: false,
            key: (folder.to_path_buf(), name, size),
        })
    }

    /// Picks up an interrupted copy of this same file (same folder, name and size) from this session, if there is
    /// one and it is exactly as long as it was when it was set aside. Its hash is rebuilt from what is on disk.
    pub fn resume(folder: &Path, proposed: &str, size: u64) -> Option<Self> {
        let name = safe_name(proposed)?;
        let key = (folder.to_path_buf(), name, size);
        let entry = {
            let mut parked = PARKED.lock().ok()?;
            let at = parked.iter().position(|entry| entry.key == key)?;
            parked.remove(at)
        };
        let reopen = || -> io::Result<Self> {
            let mut read = File::open(&entry.part)?;
            if read.metadata()?.len() != entry.written {
                return Err(io::Error::other("the kept part changed"));
            }
            let mut hasher = Sha256::new();
            let mut buffer = vec![0u8; 64 * 1024];
            loop {
                let count = io::Read::read(&mut read, &mut buffer)?;
                if count == 0 {
                    break;
                }
                hasher.update(&buffer[..count]);
            }
            let file = OpenOptions::new().append(true).open(&entry.part)?;
            Ok(Self {
                part: entry.part.clone(),
                target: entry.target.clone(),
                file: Some(file),
                expected: size,
                written: entry.written,
                hasher,
                done: false,
                parked: false,
                key: key.clone(),
            })
        };
        match reopen() {
            Ok(incoming) => Some(incoming),
            Err(_) => {
                let _ = fs::remove_file(&entry.part);
                None
            }
        }
    }

    /// How much is already here and the SHA-256 of exactly those bytes, for the viewer to check against its own copy.
    pub fn resume_point(&self) -> (u64, String) {
        (self.written, hex(&self.hasher.clone().finalize()))
    }

    /// Sets an interrupted file aside for a reconnecting viewer instead of deleting it. Nothing is kept if nothing
    /// arrived yet.
    pub fn park(mut self) {
        if self.done || self.written == 0 {
            return;
        }
        if let Some(mut file) = self.file.take() {
            let _ = file.flush();
            let _ = file.sync_all();
        }
        if let Ok(mut parked) = PARKED.lock() {
            if parked.len() >= MAX_PARKED {
                let oldest = parked.remove(0);
                let _ = fs::remove_file(oldest.part);
            }
            parked.push(Parked {
                key: self.key.clone(),
                part: self.part.clone(),
                target: self.target.clone(),
                written: self.written,
            });
            self.parked = true;
        }
    }

    pub fn final_name(&self) -> String {
        self.target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
            .to_string()
    }

    pub fn written(&self) -> u64 {
        self.written
    }

    /// Appends a chunk. Fails if it would run past the announced size.
    pub fn write(&mut self, bytes: &[u8]) -> io::Result<()> {
        if bytes.is_empty()
            || bytes.len() > MAX_CHUNK
            || self.written + bytes.len() as u64 > self.expected
        {
            return Err(io::Error::other("chunk outside the announced size"));
        }
        self.file
            .as_mut()
            .ok_or_else(|| io::Error::other("closed"))?
            .write_all(bytes)?;
        self.hasher.update(bytes);
        self.written += bytes.len() as u64;
        Ok(())
    }

    /// Completes the file when it is the announced length and matches the sender's SHA-256.
    pub fn finish(mut self, sha256_hex: &str) -> io::Result<String> {
        if self.written != self.expected {
            return Err(io::Error::other("file is shorter than announced"));
        }
        let digest = hex(&self.hasher.clone().finalize());
        if !digest.eq_ignore_ascii_case(sha256_hex) {
            return Err(io::Error::other("file did not match its checksum"));
        }
        let mut file = self.file.take().ok_or_else(|| io::Error::other("closed"))?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::rename(&self.part, &self.target)?;
        self.done = true;
        mark_from_internet(&self.target);
        Ok(self.final_name())
    }
}

impl Drop for Incoming {
    fn drop(&mut self) {
        if !self.done && !self.parked {
            self.file.take();
            let _ = fs::remove_file(&self.part);
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The Mark of the Web: Windows (SmartScreen, Office, the shell) treats the file as downloaded.
fn mark_from_internet(path: &Path) {
    let mut stream = path.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    let _ = fs::write(stream, "[ZoneTransfer]\r\nZoneId=3\r\n");
}

/// A short line for the sharing window: what is arriving or just arrived. Written by the transfer task,
/// read by the window's timer.
static STATUS: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
pub fn set_status(text: &str) {
    if let Ok(mut status) = STATUS.lock() {
        *status = text.to_string();
    }
}
pub fn status() -> String {
    STATUS
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default()
}

/// A file the person at this computer chose to send to the helper (picked in the sharing window).
static OUTBOX: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);
pub fn request_send(path: PathBuf) {
    if let Ok(mut outbox) = OUTBOX.lock() {
        *outbox = Some(path);
    }
}
pub fn take_send() -> Option<PathBuf> {
    OUTBOX.lock().ok().and_then(|mut outbox| outbox.take())
}

/// One outgoing file: read in small chunks, hashed as it goes.
pub struct Outgoing {
    file: File,
    pub name: String,
    pub size: u64,
    sent: u64,
    hasher: Sha256,
}

impl Outgoing {
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_FILE {
            return Err(io::Error::other("not a sendable file"));
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(safe_name)
            .ok_or_else(|| io::Error::other("unusable file name"))?;
        Ok(Self {
            file,
            name,
            size: metadata.len(),
            sent: 0,
            hasher: Sha256::new(),
        })
    }
    pub fn sent(&self) -> u64 {
        self.sent
    }
    /// The next chunk, or None at the end of the file.
    pub fn next_chunk(&mut self) -> io::Result<Option<Vec<u8>>> {
        use std::io::Read;
        let mut buffer = vec![0u8; 16 * 1024];
        let read = self.file.read(&mut buffer)?;
        if read == 0 {
            return Ok(None);
        }
        buffer.truncate(read);
        self.hasher.update(&buffer);
        self.sent += read as u64;
        Ok(Some(buffer))
    }
    /// The SHA-256 of everything read so far, once the file is finished.
    pub fn digest(&self) -> io::Result<String> {
        if self.sent != self.size {
            return Err(io::Error::other("file changed while sending"));
        }
        Ok(hex(&self.hasher.clone().finalize()))
    }
}

/// Whether the helper's viewer says it is recording this session right now (they announce it; the sharing window shows it).
static RECORDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn set_recording(on: bool) {
    RECORDING.store(on, std::sync::atomic::Ordering::Release);
}
pub fn recording() -> bool {
    RECORDING.load(std::sync::atomic::Ordering::Acquire)
}

/// Where received files go: `Downloads\Beacon Remote` in the signed-in user's profile.
pub fn received_folder() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|profile| {
        PathBuf::from(profile)
            .join("Downloads")
            .join("Beacon Remote")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let folder = std::env::temp_dir().join(format!("beacon-files-{}", uuid_like()));
        fs::create_dir_all(&folder).unwrap();
        folder
    }
    fn uuid_like() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    #[test]
    fn names_are_one_safe_path_component() {
        assert_eq!(safe_name("report.pdf").as_deref(), Some("report.pdf"));
        assert_eq!(
            safe_name("..\\..\\Windows\\evil.exe").as_deref(),
            Some("evil.exe")
        );
        assert_eq!(safe_name("C:/Users/x/a.txt").as_deref(), Some("a.txt"));
        assert_eq!(safe_name("a<b>c:d.txt").as_deref(), Some("a_b_c_d.txt"));
        assert_eq!(safe_name("trailing. . ").as_deref(), Some("trailing"));
        assert_eq!(safe_name("CON.txt").as_deref(), Some("_CON.txt"));
        assert_eq!(safe_name("com1").as_deref(), Some("_com1"));
        assert_eq!(safe_name("com0.txt").as_deref(), Some("com0.txt"));
        assert_eq!(safe_name("bad\u{0}\u{7}name").as_deref(), Some("badname"));
        assert_eq!(safe_name(""), None);
        assert_eq!(safe_name("..."), None);
        assert_eq!(safe_name("a/").as_deref(), None);
        let long = format!("{}.tar.gz", "x".repeat(400));
        assert!(safe_name(&long).unwrap().chars().count() <= 120 + 16);
    }

    #[test]
    fn collisions_get_a_number_and_nothing_is_overwritten() {
        let folder = temp();
        fs::write(folder.join("a.txt"), "old").unwrap();
        fs::write(folder.join("a (1).txt"), "old").unwrap();
        assert_eq!(unique_path(&folder, "a.txt"), folder.join("a (2).txt"));
        assert_eq!(unique_path(&folder, "b.txt"), folder.join("b.txt"));
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn a_good_file_arrives_whole_marked_and_under_its_final_name() {
        let folder = temp();
        let data = vec![7u8; 100_000];
        let digest = hex(&Sha256::digest(&data));
        let mut incoming = Incoming::begin(&folder, "tool.exe", data.len() as u64).unwrap();
        for chunk in data.chunks(MAX_CHUNK) {
            incoming.write(chunk).unwrap();
        }
        assert!(
            !folder.join("tool.exe").exists(),
            "no final name before the end"
        );
        assert_eq!(incoming.finish(&digest).unwrap(), "tool.exe");
        assert_eq!(fs::read(folder.join("tool.exe")).unwrap(), data);
        let zone = fs::read_to_string(folder.join("tool.exe:Zone.Identifier")).unwrap();
        assert!(zone.contains("ZoneId=3"));
        assert!(fs::read_dir(&folder).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".beaconpart")));
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn short_long_corrupt_and_abandoned_files_leave_nothing_behind() {
        let folder = temp();
        let mut short = Incoming::begin(&folder, "s.bin", 10).unwrap();
        short.write(&[1; 4]).unwrap();
        assert!(short.finish(&hex(&Sha256::digest([1u8; 4]))).is_err());

        let mut long = Incoming::begin(&folder, "l.bin", 4).unwrap();
        assert!(long.write(&[1; 5]).is_err(), "past the announced size");
        assert!(long.write(&[]).is_err());
        drop(long);

        let mut corrupt = Incoming::begin(&folder, "c.bin", 3).unwrap();
        corrupt.write(&[1, 2, 3]).unwrap();
        assert!(corrupt.finish(&"0".repeat(64)).is_err());

        let abandoned = Incoming::begin(&folder, "x.bin", 3).unwrap();
        drop(abandoned);

        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn sizes_and_names_are_refused_up_front() {
        let folder = temp();
        assert_eq!(
            Incoming::begin(&folder, "a", 0).err(),
            Some(Refusal::TooLarge)
        );
        assert_eq!(
            Incoming::begin(&folder, "a", MAX_FILE + 1).err(),
            Some(Refusal::TooLarge)
        );
        assert_eq!(
            Incoming::begin(&folder, "...", 5).err(),
            Some(Refusal::Name)
        );
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn an_outgoing_file_streams_whole_and_hashes_to_what_the_other_side_will_check() {
        let folder = temp();
        let data: Vec<u8> = (0..50_000u32).map(|n| (n % 251) as u8).collect();
        let path = folder.join("report.bin");
        fs::write(&path, &data).unwrap();
        let mut outgoing = Outgoing::open(&path).unwrap();
        assert_eq!(outgoing.name, "report.bin");
        assert_eq!(outgoing.size, 50_000);
        assert!(outgoing.digest().is_err(), "not finished yet");
        let mut received = Vec::new();
        while let Some(chunk) = outgoing.next_chunk().unwrap() {
            assert!(chunk.len() <= 16 * 1024);
            received.extend_from_slice(&chunk);
        }
        assert_eq!(received, data);
        assert_eq!(outgoing.digest().unwrap(), hex(&Sha256::digest(&data)));
        // Empty files and folders are refused.
        fs::write(folder.join("empty"), b"").unwrap();
        assert!(Outgoing::open(&folder.join("empty")).is_err());
        assert!(Outgoing::open(&folder).is_err());
        let _ = fs::remove_dir_all(folder);
    }
}
