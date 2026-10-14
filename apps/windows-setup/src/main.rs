//! Beacon Remote installer and uninstaller: one signed-ready executable, no administrator rights.
//!
//! Double-click installs for the current user under `%LOCALAPPDATA%\Programs\Beacon Remote`, adds a Start
//! menu shortcut, an Apps and features entry and (unless the person turns it off in the host window) start at
//! sign-in, then opens the host. The same executable, copied into the install folder, uninstalls: it stops the
//! host, removes everything it added and this computer's local credentials.
//!
//! On a fresh computer it offers, once, to trust Beacon Remote's own signing certificate (one administrator
//! approval; ADR 0035). `--silent` never asks for or performs that.
//!
//! `--silent` skips the dialogs (for automation). `BEACON_SETUP_SANDBOX=1` keeps every registry write under a
//! private test key so tests never touch a real install; paths still follow `LOCALAPPDATA` and `APPDATA`.
#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod install;
#[cfg(windows)]
mod trust;

#[cfg(windows)]
fn main() {
    install::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("The Beacon Remote installer is for Windows.");
    std::process::exit(1);
}

/// Names inside the install folder that this program owns. Anything else found there is left alone.
pub const OWNED: [&str; 6] = [
    "beacon-remote-agent.exe",
    "beacon-remote-host.exe",
    "beacon-remote-session.exe",
    "manifest.json",
    "Uninstall Beacon Remote.exe",
    "previous",
];

/// The short form shown in Apps and features, from the package manifest's commit.
pub fn display_version(manifest: &[u8]) -> String {
    // PowerShell writes the package manifest with a byte order mark.
    let manifest = manifest
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(manifest);
    serde_json::from_slice::<serde_json::Value>(manifest)
        .ok()
        .and_then(|value| value["commit"].as_str().map(str::to_owned))
        .filter(|commit| {
            (8..=40).contains(&commit.len()) && commit.bytes().all(|b| b.is_ascii_hexdigit())
        })
        .map(|commit| format!("0.1.0 ({})", &commit[..8]))
        .unwrap_or_else(|| "0.1.0".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comes_from_a_well_formed_commit_only() {
        let good = br#"{"kind":"beacon-remote-development-v2","commit":"0123456789abcdef0123456789abcdef01234567"}"#;
        assert_eq!(display_version(good), "0.1.0 (01234567)");
        assert_eq!(display_version(br#"{"commit":"not hex!!"}"#), "0.1.0");
        assert_eq!(display_version(b"garbage"), "0.1.0");
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(good);
        assert_eq!(display_version(&bom), "0.1.0 (01234567)");
    }
}
