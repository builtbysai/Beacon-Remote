//! Temporary support (ADR 0038). A file named `BeaconSupport-<link token>.exe` is this same program started from a
//! technician's link. It lays the programs down in a private folder, runs the host window in support mode against that
//! folder and starts a supervisor that runs it and removes everything again when support ends. Nothing is installed: no Start menu entry, no
//! Apps and features entry, no start at sign-in, no certificate trust, no administrator approval.
use crate::install::{Error, AGENT, HOST, MANIFEST, SESSION};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

const NO_WINDOW: u32 = 0x0800_0000;

/// The link token carried in the program's file name, tolerating the " (1)" a browser may add to a repeat download.
pub fn token_from_name(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let rest = stem.strip_prefix("BeaconSupport-")?;
    let token = rest.get(..32)?;
    token
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        .then(|| token.to_owned())
}

fn folder_id() -> String {
    let mut hash = Sha256::new();
    hash.update(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
            .to_le_bytes(),
    );
    hash.update(std::process::id().to_le_bytes());
    hash.update(
        env::current_exe()
            .unwrap_or_default()
            .to_string_lossy()
            .as_bytes(),
    );
    hash.finalize()[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn run(token: &str) -> Result<(), Error> {
    if AGENT.is_empty() || HOST.is_empty() || SESSION.is_empty() {
        return Err("This is a development stub without the Beacon Remote programs inside.".into());
    }
    let local = PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is not set")?);
    let root = local.join("BeaconSupport").join(folder_id());
    fs::create_dir_all(root.join("data"))?;
    let source = env::current_exe()?;
    for (name, bytes) in [
        ("beacon-remote-agent.exe", AGENT),
        ("beacon-remote-host.exe", HOST),
        ("beacon-remote-session.exe", SESSION),
        ("manifest.json", MANIFEST),
    ] {
        fs::write(root.join(name), bytes)?;
    }
    let host = root.join("beacon-remote-host.exe");
    // The supervisor outlives this program: it runs the support window, brings it back after a crash or a restart,
    // and removes everything when support really ends. This program is free to exit, and its file is removed with the rest.
    Command::new(&host)
        .arg("--support-supervise")
        .arg(&root)
        .arg(&source)
        .arg(token)
        .current_dir(env::temp_dir())
        // The host keeps all of its state under the private folder, apart from any installed Beacon Remote.
        .env("BEACON_REAL_LOCALAPPDATA", &local)
        .creation_flags(NO_WINDOW)
        .spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_comes_from_the_name_only() {
        let token = "abcD".repeat(8);
        let name = |file: &str| PathBuf::from(format!(r"C:\Users\x\Downloads\{file}"));
        assert_eq!(
            token_from_name(&name(&format!("BeaconSupport-{token}.exe"))).as_deref(),
            Some(token.as_str())
        );
        assert_eq!(
            token_from_name(&name(&format!("BeaconSupport-{token} (1).exe"))).as_deref(),
            Some(token.as_str())
        );
        for bad in [
            "BeaconRemoteSetup-0123456789.exe",
            "BeaconSupport-short.exe",
            "BeaconSupport-abc$abcDabcDabcDabcDabcDabcDabcDabc.exe",
            "setup.exe",
        ] {
            assert_eq!(token_from_name(&name(bad)), None, "{bad}");
        }
    }
}
