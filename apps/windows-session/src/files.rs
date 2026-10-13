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

/// `name`, or `name (1)`, `name (2)`… the first that does not exist in `folder`.
pub fn unique_path(folder: &Path, name: &str) -> PathBuf {
    let candidate = folder.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, extension) = match name.rfind('.') {
        Some(at) if at > 0 => (&name[..at], &name[at..]),
        _ => (name, ""),
    };
    (1..10_000)
        .map(|n| folder.join(format!("{stem} ({n}){extension}")))
        .find(|path| !path.exists())
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
        })
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
        if !self.done {
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
}
