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

Local Rust compilation is unavailable because MSVC `link.exe` is absent. Windows
CI supplied the native artifact after formatting, Clippy, tests and release build
passed in [the encoder run](https://github.com/builtbysai/Beacon-Remote/actions/runs/38008501546).
Its actual owner-PC benchmark passed: 90 synthetic frames, 150,496 encoded bytes,
first packet 9.68 ms, mean encode/readback 4.06 ms, Annex-B SPS/PPS/IDR present,
and monotonic timestamps. Two hardware transforms were advertised; this test used
the inbox software MFT on Intel Iris Xe hardware. These measurements exclude
real capture, WebRTC, browser decoding and network latency. No frame was saved
or uploaded. This establishes a software prototype path, not a shipping hardware
encoder decision.

The owner requested a temporary testing account and postponed broader account
creation/UI redesign. That account is now provisioned, signed into the production
browser and paired to the actual Windows PC; its credentials are restricted to
the owner's local recovery folder, outside both repositories.

## WebRTC acceptance blocker — 2026-10-10

The media branch now includes authenticated, one-use view grants, bounded
WebSocket signaling, a synthetic H.264/WebRTC helper and a browser video viewer.
Its [Windows build](https://github.com/builtbysai/Beacon-Remote/actions/runs/38029036705)
passed formatting, Clippy, native tests and release compilation. Backend checks
exercise real PostgreSQL, account/origin isolation, consent gating, grant reuse,
revocation and logout. A follow-up renewal protocol measures lease age from
native challenge-send time rather than delayed reply receipt. The final renewal
change also passed the complete [Windows and backend/web CI run](https://github.com/builtbysai/Beacon-Remote/actions/runs/38030855483).

The next hardening increment bounds native signaling writes and socket shutdown,
checks renewal and absolute grant expiry again before sending queued video, and
limits each media write to the remaining authorization time. Expired leases
cannot be revived by a later reply. Deterministic native regression checks cover
delayed, duplicate, unknown, reordered and discarded renewal challenges; these
checks do not replace actual Windows/browser media acceptance.

Actual owner-PC browser decoding could not run: Windows Application Control
blocked both new executables before startup. Code Integrity event 3077 identifies
policy `0283ac0f-fff1-49ae-ada1-8a933130cad6`; Smart App Control state is On. No
current-user code-signing certificate was found. No protection, policy, trust
store or file security metadata was changed to bypass the block. Microsoft
[documents signing as the developer path](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).

The owner subsequently changed Smart App Control and requested a retry. Both
executables from [the final media build](https://github.com/builtbysai/Beacon-Remote/actions/runs/38054167791)
then started. An isolated local PostgreSQL account, actual signed native agent,
one-use grant and Chrome viewer established WebRTC: the page reported connected
and actual decoded H.264 frames. Browser Stop cleared the video and terminated
the native media helper. This proves synthetic native-to-browser decoding on the
same Windows PC; it does not prove desktop capture, cross-network or relay use.

The next increment adds a visible native Stop video test window before native
consent and media. Clicking Stop or closing it clears the same atomic active
state used by encoder/signaling; failure to create the window refuses media.
The window owns its message loop and state lifetime, following Microsoft's
[Win32 message-loop guidance](https://learn.microsoft.com/en-us/windows/win32/winmsg/using-messages-and-message-queues).
Actual local Stop acceptance is required before desktop sharing is connected.

Local Stop acceptance passed: the owner clicked the native button during real
synthetic decoding; the helper exited, Chrome cleared video, and PostgreSQL
marked the session ended. Real browser Stop, logout and absolute two-minute
expiry also passed; the expiry run decoded 3,292 frames before clearing media.

The next development increment connects consented primary-display WGC capture
to the same bounded encoder/transport. It preserves the Windows border and
cursor, refuses capture until a connected peer and live challenge lease exist,
fits BGRA into 1280×720 NV12 without stretching, and retains no recording.
Conversion uses [Microsoft's limited-range BT.601 formulas](https://learn.microsoft.com/en-us/windows/win32/medfound/recommended-8-bit-yuv-formats-for-video-rendering)
and deterministic checks for BGRA channel order, NV12 chroma layout, letterbox
values and malformed buffers. Desktop acceptance is still pending; no input,
microphone, recording or unattended sharing is added.

Production still runs the validated identity/presence release. Attended desktop
streaming, local Stop sharing acceptance, forced relay and input remain
incomplete. Account creation and broader UI/UX redesign remain postponed at the
owner's request. Release signing remains required; this development retry does
not replace a signed installer/update path.
