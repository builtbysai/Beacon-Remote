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
    // Set for a hardware (asynchronous) transform: its work is driven by events, not by polling output.
    events: Option<IMFMediaEventGenerator>,
    need_input: u32,
    width: u32,
    height: u32,
    fps: u32,
    // COM objects above are dropped before shutting down the runtime.
    _runtime: Runtime,
}

impl Encoder {
    /// The graphics card's H.264 encoder when it works (far less CPU), otherwise the inbox software one.
    /// `BEACON_SOFTWARE_ENCODER=1` forces software.
    pub fn new(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self, Error> {
        if std::env::var_os("BEACON_SOFTWARE_ENCODER").is_none() {
            match Self::hardware(width, height, fps, bitrate) {
                Ok(encoder) => return Ok(encoder),
                Err(error) => {
                    println!("Hardware H.264 encoder unavailable ({error}); using software.")
                }
            }
        }
        Self::software(width, height, fps, bitrate)
    }

    fn check(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<(), Error> {
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
        Ok(())
    }

    pub fn software(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self, Error> {
        Self::check(width, height, fps, bitrate)?;
        let runtime = Runtime::start()?;
        // Explicit inbox software MFT.
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
            events: None,
            need_input: 0,
            width,
            height,
            fps,
            _runtime: runtime,
        })
    }

    /// The first hardware H.264 encoder, proven by encoding a few blank frames before it is trusted.
    fn hardware(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self, Error> {
        Self::check(width, height, fps, bitrate)?;
        let runtime = Runtime::start()?;
        let input_type = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_NV12,
        };
        let output_type = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_H264,
        };
        let transform: IMFTransform = unsafe {
            let mut pointer = std::ptr::null_mut();
            let mut count = 0;
            MFTEnumEx(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                Some(&input_type),
                Some(&output_type),
                &mut pointer,
                &mut count,
            )?;
            if count == 0 || pointer.is_null() {
                return Err("no hardware encoder".into());
            }
            let mut found = None;
            for activation in std::slice::from_raw_parts_mut(pointer, count as usize) {
                if let Some(activation) = activation.take() {
                    if found.is_none() {
                        found = activation.ActivateObject::<IMFTransform>().ok();
                    }
                }
            }
            CoTaskMemFree(Some(pointer.cast()));
            found.ok_or("hardware encoder could not be activated")?
        };
        unsafe {
            let attributes = transform.GetAttributes()?;
            if attributes.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) == 0 {
                return Err("hardware encoder is not asynchronous".into());
            }
            attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
            attributes.SetUINT32(&MF_LOW_LATENCY, 1)?;
            let codec: ICodecAPI = transform.cast()?;
            let _ = codec.SetValue(&CODECAPI_AVLowLatencyMode, &VARIANT::from(true));
            let _ = codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &VARIANT::from(0u32));
            let _ = codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(fps));
            let _ = codec.SetValue(&CODECAPI_AVEncCommonRateControlMode, &VARIANT::from(0u32));
            let _ = codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &VARIANT::from(bitrate));
            let output = media_type(width, height, fps, &MFVideoFormat_H264)?;
            output.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, 66)?;
            transform.SetOutputType(0, &output, 0)?;
            let input = media_type(width, height, fps, &MFVideoFormat_NV12)?;
            transform.SetInputType(0, &input, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }
        let events: IMFMediaEventGenerator = transform.cast()?;
        let mut encoder = Self {
            transform,
            events: Some(events),
            need_input: 0,
            width,
            height,
            fps,
            _runtime: runtime,
        };
        // Proof of life: a few blank frames must come back as H.264 promptly, or this device is not used.
        let blank = vec![128u8; (width * height * 3 / 2) as usize];
        let mut produced = 0;
        for index in 0..6 {
            produced += encoder.encode(&blank, index)?.len();
        }
        if produced == 0 {
            return Err("hardware encoder produced no output".into());
        }
        Ok(encoder)
    }

    pub fn is_hardware(&self) -> bool {
        self.events.is_some()
    }

    /// Handles whatever the hardware encoder has announced: it wants input, or has output to collect.
    fn pump_events(&mut self, frames: &mut Vec<EncodedFrame>) -> Result<(), Error> {
        let Some(events) = self.events.clone() else {
            return Ok(());
        };
        for _ in 0..64 {
            let event = unsafe { events.GetEvent(MF_EVENT_FLAG_NO_WAIT) };
            let event = match event {
                Ok(event) => event,
                Err(error) if error.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(()),
                Err(error) => return Err(error.into()),
            };
            let kind = unsafe { event.GetType()? };
            if kind == METransformNeedInput.0 as u32 {
                self.need_input += 1;
            } else if kind == METransformHaveOutput.0 as u32 {
                if let Some(frame) = self.take_output()? {
                    frames.push(frame);
                }
            } else if kind == MEError.0 as u32 {
                return Err("hardware encoder reported an error".into());
            }
        }
        Ok(())
    }

    fn encode_hardware(&mut self, sample: &IMFSample) -> Result<Vec<EncodedFrame>, Error> {
        let mut frames = Vec::new();
        // The encoder says when it can take a frame.
        let waited = Instant::now();
        while self.need_input == 0 {
            self.pump_events(&mut frames)?;
            if self.need_input == 0 {
                if waited.elapsed() > Duration::from_millis(250) {
                    return Err("hardware encoder stopped asking for frames".into());
                }
                std::thread::sleep(Duration::from_micros(500));
            }
        }
        unsafe { self.transform.ProcessInput(0, sample, 0)? };
        self.need_input -= 1;
        // Hardware usually answers within a few milliseconds; wait briefly so the frame leaves with its own tick.
        let started = Instant::now();
        while frames.is_empty() && started.elapsed() < Duration::from_millis(40) {
            self.pump_events(&mut frames)?;
            if frames.is_empty() {
                std::thread::sleep(Duration::from_micros(500));
            }
        }
        Ok(frames)
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
            if self.events.is_some() {
                return self.encode_hardware(&sample);
            }
            self.transform.ProcessInput(0, &sample, 0)?;
        }
        self.receive()
    }

    pub fn drain(&mut self) -> Result<Vec<EncodedFrame>, Error> {
        if self.events.is_some() {
            // An asynchronous encoder is drained by command, then its remaining output is collected.
            unsafe {
                self.transform
                    .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?
            };
            let mut frames = Vec::new();
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(500) {
                self.pump_events(&mut frames)?;
                std::thread::sleep(Duration::from_millis(2));
            }
            return Ok(frames);
        }
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
            match self.take_output()? {
                Some(frame) => frames.push(frame),
                None => return Ok(frames),
            }
        }
        Err("Encoder exceeded bounded output polling".into())
    }

    /// One encoded frame, or None when the encoder needs more input.
    fn take_output(&mut self) -> Result<Option<EncodedFrame>, Error> {
        {
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
                    return Ok(None);
                }
                if error.code() == MF_E_TRANSFORM_STREAM_CHANGE {
                    // The encoder settled its real output format (it now knows its sequence headers): accept it.
                    unsafe {
                        let format = self.transform.GetOutputAvailableType(0, 0)?;
                        self.transform.SetOutputType(0, &format, 0)?;
                    }
                    return Ok(None);
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
            Ok(Some(EncodedFrame { bytes, timestamp }))
        }
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
    println!(
        "Advertised hardware H.264 encoders: {}. Benchmark uses the {} encoder, Baseline, low latency, no B frames.",
        hardware_count()?,
        if encoder.is_hardware() { "HARDWARE" } else { "inbox software" }
    );
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
        let packets = encoder
            .encode(&nv12, frame)
            .map_err(|error| format!("encode of frame {frame} failed: {error}"))?;
        encode_time += encoding.elapsed();
        consume(packets)?;
        let deadline = started + Duration::from_secs_f64((frame + 1) as f64 / 30.0);
        if let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
            std::thread::sleep(remaining);
        }
    }
    consume(
        encoder
            .drain()
            .map_err(|error| format!("drain failed: {error}"))?,
    )?;
    if outputs != 90 || idr == 0 || sps == 0 || pps == 0 {
        return Err(
            "Synthetic H.264 output did not contain all frames and Annex-B SPS/PPS/IDR".into(),
        );
    }
    println!("Synthetic 1280x720 H.264: {outputs} frames, {bytes} bytes, first packet {:.2} ms, mean encode/readback {:.2} ms, IDR {idr}, SPS {sps}, PPS {pps}. Packets stayed in memory; no screen capture, recording or upload.", first.unwrap().as_secs_f64()*1000.0, encode_time.as_secs_f64()*1000.0/90.0);
    Ok(())
}
