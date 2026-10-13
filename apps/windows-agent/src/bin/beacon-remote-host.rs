#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
#[path = "../host_window.rs"]
mod host_window;

fn main() {
    #[cfg(windows)]
    if host_window::show(std::env::args().any(|argument| argument == "--background")).is_err() {
        host_window::show_startup_error();
    }
    #[cfg(not(windows))]
    eprintln!("Beacon Remote host requires Windows.");
}
