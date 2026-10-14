#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
#[path = "../host_window.rs"]
mod host_window;
#[cfg(windows)]
#[path = "../support_window.rs"]
mod support_window;

/// `--apply-update <install dir> <old pid> <sequence>` and `--rollback <install dir>` are run by the
/// updater, not by people. Failures are written next to the install, since this program has no console.
#[cfg(windows)]
fn maintenance(arguments: &[String]) -> bool {
    let log = |install: &str, message: String| {
        let _ = std::fs::write(std::path::Path::new(install).join("update.log"), message);
    };
    match arguments.get(1).map(String::as_str) {
        Some("--apply-update") if arguments.len() == 5 => {
            let sequence = arguments[4].parse().unwrap_or(0);
            let pid = arguments[3].parse().unwrap_or(0);
            if let Err(error) = beacon_remote_agent::apply_update(
                std::path::Path::new(&arguments[2]),
                pid,
                sequence,
            ) {
                log(&arguments[2], format!("Update failed: {error}"));
            }
            true
        }
        Some("--rollback") if arguments.len() == 3 => {
            if let Err(error) =
                beacon_remote_agent::rollback_update(std::path::Path::new(&arguments[2]))
            {
                log(&arguments[2], format!("Rollback failed: {error}"));
            }
            true
        }
        // Temporary support (ADR 0038). `--support-supervise <folder> [download] [link token]` runs and watches a session
        // (and is what comes back after a restart); `--support-window [token]` is the window it runs.
        Some("--support-supervise") if arguments.len() >= 3 => {
            let _ = beacon_remote_agent::support_supervisor::supervise(
                std::path::Path::new(&arguments[2]),
                arguments.get(3).map(std::path::Path::new),
                arguments.get(4).map(String::as_str),
            );
            true
        }
        Some("--support-window") => {
            if support_window::show(arguments.get(2).map(String::as_str)).is_err() {
                host_window::show_startup_error();
            }
            true
        }
        Some("--support-cleanup") if arguments.len() >= 3 => {
            // A leftover session (crash, restart): tell the server it is over if the identity is still here, so the
            // technician sees it ended, then remove everything.
            let folder = std::path::Path::new(&arguments[2]);
            if beacon_remote_agent::support::is_support_root(folder) {
                std::env::set_var("LOCALAPPDATA", folder.join("data"));
                beacon_remote_agent::support::end();
            }
            let _ = beacon_remote_agent::support::cleanup(
                std::path::Path::new(&arguments[2]),
                arguments.get(3).map(std::path::Path::new),
            );
            true
        }
        _ => false,
    }
}

fn main() {
    #[cfg(windows)]
    if maintenance(&std::env::args().collect::<Vec<_>>()) {
        return;
    }
    #[cfg(windows)]
    if host_window::show(std::env::args().any(|argument| argument == "--background")).is_err() {
        host_window::show_startup_error();
    }
    #[cfg(not(windows))]
    eprintln!("Beacon Remote host requires Windows.");
}
