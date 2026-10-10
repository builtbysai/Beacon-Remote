//! In-memory Media Foundation H.264 spike. No capture, files or network.
use std::{
    mem::ManuallyDrop,
    time::{Duration, Instant},
};
use windows::{
    core::Interface,
    Win32::{
        Media::MediaFoundation::*,
        System::{Com::*, Variant::VARIANT},
    },
};

type Error = Box<dyn std::error::Error + Send + Sync>;
const MAX_PACKET: u32 = 4 * 1024 * 1024;

struct Runtime;
impl Runtime {
    fn start() -> Result<Self, Error> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            if let Err(error) = MFStartup(MF_VERSION, MFSTARTUP_FULL) {
                CoUninitialize();
                return Err(error.into());
            }
        }
        Ok(Self)
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
            CoUninitialize();
        }
    }
}

pub struct EncodedFrame {
    pub bytes: Vec<u8>,
    pub timestamp: i64,
}

pub struct Encoder {
    transform: IMFTransform,
    width: u32,
    height: u32,
    fps: u32,
    // COM objects above are dropped before shutting down the runtime.
    _runtime: Runtime,
}

impl Encoder {
    pub fn new(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self, Error> {
        if width == 0
            || height == 0
            || width > 1920
            || height > 1080
            || !width.is_multiple_of(2)
            || !height.is_multiple_of(2)
            || fps == 0
            || fps > 60
            || bitrate == 0
        {
            return Err("Invalid bounded encoder configuration".into());
        }
        let runtime = Runtime::start()?;
        // Explicit inbox software MFT: hardware enumeration is reported separately.
        let transform: IMFTransform =
            unsafe { CoCreateInstance(&CLSID_MSH264EncoderMFT, None, CLSCTX_INPROC_SERVER)? };
        unsafe {
            transform.GetAttributes()?.SetUINT32(&MF_LOW_LATENCY, 1)?;
            let codec: ICodecAPI = transform.cast()?;
            codec.SetValue(&CODECAPI_AVLowLatencyMode, &VARIANT::from(true))?;
            codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &VARIANT::from(0u32))?;
            codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(fps))?;
            let output = media_type(width, height, fps, &MFVideoFormat_H264)?;
            output.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, 66)?; // H.264 Baseline: no B frames.
            transform.SetOutputType(0, &output, 0)?;
            let input = media_type(width, height, fps, &MFVideoFormat_NV12)?;
            transform.SetInputType(0, &input, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        Ok(Self {
            transform,
            width,
            height,
            fps,
            _runtime: runtime,
        })
    }

    pub fn encode(&mut self, nv12: &[u8], index: u64) -> Result<Vec<EncodedFrame>, Error> {
        let required = u64::from(self.width) * u64::from(self.height) * 3 / 2;
        if nv12.len() as u64 != required || index > i64::MAX as u64 / 10_000_000 {
            return Err("Invalid frame length or timestamp".into());
        }
        unsafe {
            let buffer = MFCreateMemoryBuffer(nv12.len() as u32)?;
            let mut pointer = std::ptr::null_mut();
            buffer.Lock(&mut pointer, None, None)?;
            // The owned allocation is exactly nv12.len(); no pointer escapes Lock.
            std::ptr::copy_nonoverlapping(nv12.as_ptr(), pointer, nv12.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(nv12.len() as u32)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(index as i64 * 10_000_000 / i64::from(self.fps))?;
            sample.SetSampleDuration(10_000_000 / i64::from(self.fps))?;
            self.transform.ProcessInput(0, &sample, 0)?;
        }
        self.receive()
    }

    pub fn drain(&mut self) -> Result<Vec<EncodedFrame>, Error> {
        unsafe {
            self.transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
            self.transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
        }
        self.receive()
    }

    fn receive(&mut self) -> Result<Vec<EncodedFrame>, Error> {
        let mut frames = Vec::new();
        // Bound output work and memory even if a platform codec misbehaves.
        for _ in 0..8 {
            let info = unsafe { self.transform.GetOutputStreamInfo(0)? };
            let size = info.cbSize.max(1024 * 1024);
            if size > MAX_PACKET {
                return Err("Encoder output exceeds packet budget".into());
            }
            let supplied = if info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 == 0 {
                let sample = unsafe { MFCreateSample()? };
                let buffer = unsafe { MFCreateMemoryBuffer(size)? };
                unsafe {
                    sample.AddBuffer(&buffer)?;
                }
                Some(sample)
            } else {
                None
            };
            let mut output = MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: ManuallyDrop::new(supplied),
                dwStatus: 0,
                pEvents: ManuallyDrop::new(None),
            };
            let mut status = 0;
            let result = unsafe {
                self.transform
                    .ProcessOutput(0, std::slice::from_mut(&mut output), &mut status)
            };
            // Windows bindings use ManuallyDrop; own both returned COM references
            // on success and failure so repeated polling cannot leak them.
            let sample = unsafe { ManuallyDrop::take(&mut output.pSample) };
            drop(unsafe { ManuallyDrop::take(&mut output.pEvents) });
            if let Err(error) = result {
                if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT {
                    return Ok(frames);
                }
                return Err(error.into());
            }
            let sample = sample.ok_or("Encoder produced no sample")?;
            let timestamp = unsafe { sample.GetSampleTime()? };
            let buffer = unsafe { sample.ConvertToContiguousBuffer()? };
            let length = unsafe { buffer.GetCurrentLength()? };
            if length == 0 || length > MAX_PACKET {
                return Err("Invalid encoded packet length".into());
            }
            let mut pointer = std::ptr::null_mut();
            unsafe {
                buffer.Lock(&mut pointer, None, None)?;
            }
            let bytes = unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec();
            unsafe {
                buffer.Unlock()?;
            }
            frames.push(EncodedFrame { bytes, timestamp });
        }
        Err("Encoder exceeded bounded output polling".into())
    }
}

unsafe fn media_type(
    width: u32,
    height: u32,
    fps: u32,
    subtype: &windows::core::GUID,
) -> windows::core::Result<IMFMediaType> {
    let media = MFCreateMediaType()?;
    media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
    media.SetUINT64(
        &MF_MT_FRAME_SIZE,
        (u64::from(width) << 32) | u64::from(height),
    )?;
    media.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(fps) << 32) | 1)?;
    media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
    media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
    Ok(media)
}

fn hardware_count() -> Result<u32, Error> {
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_H264,
    };
    let mut pointer = std::ptr::null_mut();
    let mut count = 0;
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            None,
            Some(&output),
            &mut pointer,
            &mut count,
        )?;
        if count > 0 && pointer.is_null() {
            return Err("Invalid encoder enumeration".into());
        }
        if !pointer.is_null() {
            for activation in std::slice::from_raw_parts_mut(pointer, count as usize) {
                drop(activation.take());
            }
            CoTaskMemFree(Some(pointer.cast()));
        }
    }
    Ok(count)
}

pub fn benchmark() -> Result<(), Error> {
    let mut encoder = Encoder::new(1280, 720, 30, 2_500_000)?;
    println!("Advertised hardware H.264 encoders: {}. Benchmark uses inbox SOFTWARE H.264, Baseline, low latency, no B frames.", hardware_count()?);
    let mut nv12 = vec![128u8; 1280 * 720 * 3 / 2];
    let started = Instant::now();
    let mut encode_time = Duration::ZERO;
    let mut first = None;
    let mut bytes = 0u64;
    let mut outputs = 0u64;
    let mut idr = 0;
    let mut sps = 0;
    let mut pps = 0;
    let mut last_timestamp = None;
    let mut consume = |packets: Vec<EncodedFrame>| -> Result<(), Error> {
        for packet in packets {
            first.get_or_insert_with(|| started.elapsed());
            if last_timestamp.is_some_and(|last| packet.timestamp <= last) {
                return Err("Non-monotonic encoded timestamps".into());
            }
            last_timestamp = Some(packet.timestamp);
            bytes += packet.bytes.len() as u64;
            outputs += 1;
            for (index, prefix) in packet.bytes.windows(3).enumerate() {
                if prefix == [0, 0, 1] && index + 3 < packet.bytes.len() {
                    match packet.bytes[index + 3] & 0x1f {
                        5 => idr += 1,
                        7 => sps += 1,
                        8 => pps += 1,
                        _ => {}
                    }
                }
            }
        }
        Ok(())
    };
    for frame in 0..90 {
        for (index, pixel) in nv12[..1280 * 720].iter_mut().enumerate() {
            *pixel = 16 + ((index / 1280 + frame as usize * 4) % 220) as u8;
        }
        let encoding = Instant::now();
        let packets = encoder.encode(&nv12, frame)?;
        encode_time += encoding.elapsed();
        consume(packets)?;
        let deadline = started + Duration::from_secs_f64((frame + 1) as f64 / 30.0);
        if let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
            std::thread::sleep(remaining);
        }
    }
    consume(encoder.drain()?)?;
    if outputs != 90 || idr == 0 || sps == 0 || pps == 0 {
        return Err(
            "Synthetic H.264 output did not contain all frames and Annex-B SPS/PPS/IDR".into(),
        );
    }
    println!("Synthetic 1280x720 H.264: {outputs} frames, {bytes} bytes, first packet {:.2} ms, mean encode/readback {:.2} ms, IDR {idr}, SPS {sps}, PPS {pps}. Packets stayed in memory; no screen capture, recording or upload.", first.unwrap().as_secs_f64()*1000.0, encode_time.as_secs_f64()*1000.0/90.0);
    Ok(())
}
