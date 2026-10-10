#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod encoder;
#[cfg(windows)]
mod indicator;
#[cfg(windows)]
mod media;
#[cfg(any(windows, test))]
mod pixels;
#[cfg(any(windows, test))]
mod renewal;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(windows)]
    {
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
        println!("Beacon Remote interactive session helper\n  displays: physical display dimensions and DPI\n  capture-benchmark: locally consent to ten seconds of primary-display capture\n  encoder-benchmark: synthetic in-memory H.264 encoding, no screen capture\n  media-test: authenticated two-minute WebRTC viewing using a stdin grant; desktop requires local consent and visible Stop\nNo recording, audio, or input injection is implemented.");
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("The interactive session helper requires Windows".into())
    }
}
