//! Keeps a temporary support session alive through crashes and restarts (ADR 0038), and removes it when it truly ends.
//!
//! The supervisor runs the support window as a child. If the window ends on purpose (End support, the technician ending
//! it, the time limit, or a link that never worked) everything is removed. If it dies any other way (a crash, a kill) the
//! session continues in a new window with the same temporary identity, until the time limit. A `RunOnce` entry, renewed
//! on every start, brings the session back after a restart or sign-out; it removes itself when it runs.
use super::support::{self, is_support_root, resumable};
use super::*;
use std::{path::Path, process::Command, time::Instant};

const RUN_ONCE: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
pub(crate) const RUN_ONCE_VALUE: &str = "BeaconSupportCleanup";
// More than this many unplanned exits in ten minutes is a crash loop, which ends the session instead of restarting it.
const MAX_RESTARTS: usize = 5;

#[cfg(windows)]
fn register_resume(root: &Path, download: Option<&Path>) {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut command = format!(
        "\"{}\" --support-supervise \"{}\"",
        exe.display(),
        root.display()
    );
    if let Some(download) = download {
        command.push_str(&format!(" \"{}\"", download.display()));
    }
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() };
    let value = wide(&command);
    unsafe {
        let mut key = std::ptr::null_mut();
        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            wide(RUN_ONCE).as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        ) == 0
        {
            RegSetValueExW(
                key,
                wide(RUN_ONCE_VALUE).as_ptr(),
                0,
                REG_SZ,
                value.as_ptr().cast(),
                (value.len() * 2) as u32,
            );
            RegCloseKey(key);
        }
    }
}
#[cfg(not(windows))]
fn register_resume(_: &Path, _: Option<&Path>) {}

/// Runs and watches one temporary support session until it ends. `token` is the link, for the first start only.
pub fn supervise(
    root: &Path,
    download: Option<&Path>,
    token: Option<&str>,
) -> Result<(), HostError> {
    let real = std::env::var_os("BEACON_REAL_LOCALAPPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .ok_or("LOCALAPPDATA required")?;
    // Everything below, and every child, sees the private folder as its local data and the support root.
    std::env::set_var("BEACON_REAL_LOCALAPPDATA", &real);
    if !is_support_root(root) {
        return Err("Not a Beacon temporary support folder".into());
    }
    fs::create_dir_all(root.join("data"))?;
    #[cfg(windows)]
    let _only_one = {
        use std::os::windows::fs::OpenOptionsExt;
        // Released by Windows if this process dies, so a restart can take over without a stale lock file.
        match fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(0)
            .open(root.join("supervisor.lock"))
        {
            Ok(file) => file,
            Err(_) => return Ok(()),
        }
    };
    std::env::set_var("LOCALAPPDATA", root.join("data"));
    std::env::set_var("BEACON_SUPPORT_ROOT", root);
    if let Some(download) = download {
        std::env::set_var("BEACON_SUPPORT_DOWNLOAD", download);
    }
    register_resume(root, download);
    let exe = std::env::current_exe()?;
    let mut exits: Vec<Instant> = Vec::new();
    let mut first = token;
    loop {
        // A session that had been claimed and not ended continues; a first start without one needs its link.
        let mut command = Command::new(&exe);
        command
            .arg("--support-window")
            .current_dir(std::env::temp_dir());
        if !resumable(root) {
            if let Some(token) = first {
                command.arg(token);
            }
        }
        first = None;
        match command.spawn() {
            Ok(mut child) => {
                let _ = child.wait();
            }
            Err(_) => break,
        }
        if !resumable(root) {
            break;
        }
        exits.retain(|at| at.elapsed() < Duration::from_secs(600));
        exits.push(Instant::now());
        if exits.len() > MAX_RESTARTS {
            break;
        }
        thread::sleep(Duration::from_secs(3));
    }
    // Over, or unable to continue: tell the server if the identity is still here, then remove everything.
    support::end();
    support::cleanup(root, download)
}
