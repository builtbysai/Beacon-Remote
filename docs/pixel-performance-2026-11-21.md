# Pixel responsiveness investigation — 21 November 2026

Owner priority: make Pixel control smooth and responsive first, then redesign the
website with the existing sidebar retained. This session authorizes Pixel setup
and testing. It does not inherit historical production/deletion authority.

## Current physical setup

The connected Pixel 7a (`34171JEHN07672`) initially had no Beacon package, contrary
to the preceding handoff. Installed the existing signed `2cb39493` APK, paired it
through the supported device-code flow to the retained isolated test account at
`remote-test.builtbysai.com`, and ran the maintained Pixel preparation script.
Enabled Fast screen sharing through its switch and Android's entire-screen
approval. No factory reset, production change or identity transplant occurred.
The existing isolated backend was started; it retains its four-hour bound.

## Baseline

Installed Android: `2cb39493`. Viewer: locally compiled source based on `1e9c903`
with the new receiver diagnostics. Actual backend authorization and signaling;
only the owned test browser's static assets are served from the checkout.
Video: 864 × 1920, continuous capture, relay/relay on Wi-Fi.

Browser CDP mouse events alternate between Beacon's Device and Access tabs at
phone coordinates (206,2256) and (540,2256). Each sample waits 1.2 seconds for the
previous animation to settle. Timing starts at the viewer video's pointer-down
event and ends at the first changed canvas sample of the central picture (the
status and navigation bars are excluded). Pixels stay in browser memory; only
durations are recorded. Sampling is scheduled at 5 ms and is subject to browser
scheduling. This measures first visual response, not completion of the animation.

Twelve samples in milliseconds:

`263, 334, 269, 343, 264, 280, 269, 219, 285, 268, 254, 281`

Median 269 ms; range 219–343 ms. A nearby receiver sample reported network RTT
59 ms, jitter buffer 14.0 ms, decode 5.5 ms, receive-to-decode 19.6 ms, no dropped
frames in the interval. These are different measurements: receive-to-decode
includes buffering and decoding, and network RTT is not tap-to-picture delay.
WebRTC counters follow the [W3C statistics definitions](https://www.w3.org/TR/webrtc-stats/).

Do not use the old harness's synthetic-event `lat` output as this baseline. The
initial exploratory samples were not adequately settled or tied to trusted mouse
events. Also avoid `uiautomator dump` during a connected session: its automation
can suppress accessibility and legitimately end sharing. Inspect before/after,
or use capture without accessibility automation while connected.

## Candidate under development

Continuous capture currently converts each GPU texture to I420 CPU memory and
resends a cached still at intervals of 400–600 ms. The candidate shares capture's
EGL context with the session encoder, passes textures directly, and uses
`SurfaceTextureHelper.forceFrame()` to maintain output on still screens without
retaining the helper's sole in-flight texture. Authorization remains checked at
delivery. Detach drains the observer call before source disposal.

The pinned WebRTC library exposes `forceFrame`; its
[upstream implementation](https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/android/api/org/webrtc/SurfaceTextureHelper.java)
describes both forced still frames and the single in-flight texture requirement.
Performance and lifecycle improvement remain unproven until physical comparison.

Viewer diagnostics now calculate recent bitrate, jitter-buffer time, decode time,
receive-to-decode time and dropped frames using counter deltas. Missing counters,
new streams and intervals without decoded frames show unavailable values rather
than invented zero latency. These extra measurements remain local to the viewer.

## Remaining checks

- Compare the signed candidate against this baseline with the same method.
- Verify moving content, static first picture, Pause/Resume, Stop, reconnect and
  rotation; check CPU/thermal behaviour and encoder selection.
- Measure direct connectivity separately from relay and cellular. Current results
  do not establish either, sustained performance or subjective owner acceptance.
- Finish Pixel responsiveness before beginning the requested website redesign.
