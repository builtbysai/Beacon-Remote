# Native media spike

The current development branch adds a bounded in-memory Media Foundation H.264
software encoder benchmark using synthetic NV12 frames. It requests Baseline,
low latency, no B frames and a one-second GOP at 1280×720/30 FPS. The benchmark
checks output frame count, monotonically increasing timestamps and Annex-B
SPS/PPS/IDR presence; it reports encoding time and bytes without retaining media.
Hardware H.264 transform enumeration is separate and does not claim hardware use.

No screen capture, file, network or input path is used by `encoder-benchmark`.
Attended real capture, actual browser decoding and WebRTC integration are later
acceptance steps. The encode interface returns owned bounded packets rather
than a file/container, so it can feed WebRTC directly after authorization.

Microsoft's [H.264 encoder documentation](https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder)
defines the NV12 input, output-before-input type setup, Baseline and codec latency
properties. [MF_LOW_LATENCY](https://learn.microsoft.com/en-us/windows/win32/medfound/mf-low-latency)
is set on the transform as well as its ICodecAPI low-latency property.

Local Rust compilation is currently unavailable because the MSVC `link.exe`
toolchain is absent. Windows CI must compile/lint the branch, then its native
artifact must pass the benchmark on the actual owner PC before this spike is
accepted or its codec choice is described as measured.

The owner requested a temporary testing account and postponed broader account
creation/UI redesign. That account is now provisioned, signed into the production
browser and paired to the actual Windows PC; its credentials are restricted to
the owner's local recovery folder, outside both repositories.
