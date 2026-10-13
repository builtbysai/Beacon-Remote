#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
#[path = "../host_window.rs"]
mod host_window;

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
