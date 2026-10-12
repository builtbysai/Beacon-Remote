#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
#[path = "../host_window.rs"]
mod host_window;

fn main() {
    // The consumer GUI never inherits development-only control or duration overrides.
    std::env::remove_var("REMOTE_DEV_CONTROL");
    std::env::remove_var("REMOTE_DEV_SESSION_UNLIMITED");
    #[cfg(windows)]
    if host_window::show().is_err() {
        host_window::show_startup_error();
    }
    #[cfg(not(windows))]
    eprintln!("Beacon Remote host requires Windows.");
}
