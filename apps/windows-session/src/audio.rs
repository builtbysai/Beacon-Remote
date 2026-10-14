//! Sharing what this computer is playing (ADR 0044): capture of the default speakers' output through WASAPI loopback,
//! encoded as 20 ms Opus packets. It exists only for a session whose person ticked "also share this computer's
//! sound" in the consent window, and stops when the session does. Microphones are never opened.
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};
use tokio::sync::mpsc::Sender;

pub const SAMPLE_RATE: u32 = 48_000;
pub const FRAME: usize = 960; // 20 ms per channel
const CHANNELS: usize = 2;
const BYTES_PER_FRAME: usize = FRAME * CHANNELS * 2;
// If the capture falls this far behind real time, the oldest sound is dropped rather than played late.
const MAX_BACKLOG: usize = BYTES_PER_FRAME * 10;

/// Converts little-endian 16-bit stereo bytes (one 20 ms frame) to samples.
pub fn samples(bytes: &[u8]) -> Vec<i16> {
    bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| i16::from_le_bytes(*pair))
        .collect()
}

/// Takes one frame from the front of `queue`, or silence when sound has not arrived yet. Loopback capture delivers
/// nothing while nothing plays, so silence keeps the stream's clock steady instead of leaving gaps.
pub fn next_frame(queue: &mut VecDeque<u8>) -> Vec<i16> {
    if queue.len() >= BYTES_PER_FRAME {
        let bytes: Vec<u8> = queue.drain(..BYTES_PER_FRAME).collect();
        samples(&bytes)
    } else {
        vec![0; FRAME * CHANNELS]
    }
}

/// Drops the oldest sound when more than `MAX_BACKLOG` has built up.
pub fn trim(queue: &mut VecDeque<u8>) {
    if queue.len() > MAX_BACKLOG {
        let excess = queue.len() - MAX_BACKLOG;
        // Whole frames only, so channels stay aligned.
        queue.drain(..excess - excess % BYTES_PER_FRAME);
    }
}

/// Runs until `keep_going` says stop or the receiver is gone: captures the speakers' output and sends Opus packets,
/// one per 20 ms. Blocking; run it on its own thread.
#[cfg(windows)]
pub fn run(
    keep_going: impl Fn() -> bool,
    packets: Sender<Vec<u8>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
    initialize_mta().ok()?;
    let enumerator = DeviceEnumerator::new()?;
    // Capturing from a render device is loopback: what the speakers are playing.
    let device = enumerator.get_default_device(&Direction::Render)?;
    let mut client = device.get_iaudioclient()?;
    let format = WaveFormat::new(
        16,
        16,
        &SampleType::Int,
        SAMPLE_RATE as usize,
        CHANNELS,
        None,
    );
    let (default_period, _) = client.get_device_period()?;
    client.initialize_client(
        &format,
        &Direction::Capture,
        &StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: default_period,
        },
    )?;
    let event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    let mut encoder = opus::Encoder::new(
        SAMPLE_RATE,
        opus::Channels::Stereo,
        opus::Application::Audio,
    )?;
    encoder.set_bitrate(opus::Bitrate::Bits(64_000))?;
    let mut queue: VecDeque<u8> = VecDeque::with_capacity(BYTES_PER_FRAME * 16);
    let mut out = vec![0u8; 1500];
    let started = Instant::now();
    let mut sent = 0u64;
    client.start_stream()?;
    let result = (|| -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        while keep_going() {
            // A timeout just means nothing was played in that slice.
            let _ = event.wait_for_event(10);
            capture.read_from_device_to_deque(&mut queue)?;
            trim(&mut queue);
            let due = (started.elapsed().as_millis() / 20) as u64;
            while sent < due {
                let pcm = next_frame(&mut queue);
                let length = encoder.encode(&pcm, &mut out)?;
                // A full channel means the connection cannot keep up; late sound is worse than missing sound.
                if let Err(error) = packets.try_send(out[..length].to_vec()) {
                    if matches!(error, tokio::sync::mpsc::error::TrySendError::Closed(_)) {
                        return Ok(());
                    }
                }
                sent += 1;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        Ok(())
    })();
    let _ = client.stop_stream();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sound_comes_out_in_whole_frames_and_silence_fills_the_gaps() {
        let mut queue: VecDeque<u8> = VecDeque::new();
        // Nothing playing: silence, one frame's worth of samples.
        let silent = next_frame(&mut queue);
        assert_eq!(silent.len(), FRAME * CHANNELS);
        assert!(silent.iter().all(|sample| *sample == 0));
        // One and a half frames of sound: one frame out, half a frame stays.
        queue.extend(std::iter::repeat_n(
            0x34u8,
            BYTES_PER_FRAME + BYTES_PER_FRAME / 2,
        ));
        let frame = next_frame(&mut queue);
        assert_eq!(frame.len(), FRAME * CHANNELS);
        assert_eq!(frame[0], 0x3434);
        assert_eq!(queue.len(), BYTES_PER_FRAME / 2);
        // The half frame is not played alone.
        assert!(next_frame(&mut queue).iter().all(|sample| *sample == 0));
    }

    #[test]
    fn a_backlog_is_trimmed_in_whole_frames() {
        let mut queue: VecDeque<u8> = VecDeque::new();
        queue.extend(std::iter::repeat_n(
            1u8,
            MAX_BACKLOG + BYTES_PER_FRAME * 3 + 17,
        ));
        trim(&mut queue);
        assert!(queue.len() <= MAX_BACKLOG + 17);
        assert_eq!(
            (MAX_BACKLOG + BYTES_PER_FRAME * 3 + 17 - queue.len()) % BYTES_PER_FRAME,
            0
        );
    }

    #[test]
    fn opus_round_trips_a_frame_at_the_stream_rate() {
        let mut encoder = opus::Encoder::new(
            SAMPLE_RATE,
            opus::Channels::Stereo,
            opus::Application::Audio,
        )
        .unwrap();
        let mut decoder = opus::Decoder::new(SAMPLE_RATE, opus::Channels::Stereo).unwrap();
        let pcm: Vec<i16> = (0..FRAME * CHANNELS)
            .map(|index| ((index as f32 / 20.0).sin() * 8000.0) as i16)
            .collect();
        let mut packet = vec![0u8; 1500];
        let length = encoder.encode(&pcm, &mut packet).unwrap();
        assert!(length > 3 && length < 1000);
        let mut decoded = vec![0i16; FRAME * CHANNELS];
        assert_eq!(
            decoder
                .decode(&packet[..length], &mut decoded, false)
                .unwrap(),
            FRAME
        );
    }
}
