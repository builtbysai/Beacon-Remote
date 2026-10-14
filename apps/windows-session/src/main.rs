mod adapt;
#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod clipboard;
#[cfg(windows)]
mod consent;
#[cfg(windows)]
mod encoder;
#[cfg(windows)]
mod files;
#[cfg(windows)]
mod files_transport;
#[cfg(windows)]
mod indicator;
#[cfg(windows)]
mod input;
#[cfg(windows)]
mod input_transport;
#[cfg(windows)]
mod media;
#[cfg(windows)]
mod native_ui;
#[cfg(windows)]
mod pause;
#[cfg(any(windows, test))]
mod pixels;
#[cfg(any(windows, test))]
mod renewal;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(windows)]
    {
        // Whatever ends this helper, an interrupted file kept for resuming is deleted with it.
        struct DiscardKept;
        impl Drop for DiscardKept {
            fn drop(&mut self) {
                files::discard_parked();
            }
        }
        let _discard_kept = DiscardKept;
        let command = std::env::args().nth(1).unwrap_or_else(|| "help".into());
        if command == "capture-benchmark" {
            return capture::benchmark();
        }
        if command == "displays" {
            return capture::list_displays();
        }
        if command == "encoder-benchmark" {
            return encoder::benchmark();
        }
        if command == "media-test" {
            return media::run();
        }
        if command == "media-host" {
            return media::run_host();
        }
        println!("Beacon Remote interactive session helper\n  displays: physical display dimensions and DPI\n  capture-benchmark: locally consent to ten seconds of primary-display capture\n  encoder-benchmark: synthetic in-memory H.264 encoding, no screen capture\n  media-test: authenticated WebRTC using a stdin grant; desktop requires local consent and visible Stop\nNo recording or audio. Control requires a separate server scope and either local Allow control or this computer's own trusted-access setting (ADR 0021). Short authorization renewals remain mandatory.");
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("The interactive session helper requires Windows".into())
    }
}
