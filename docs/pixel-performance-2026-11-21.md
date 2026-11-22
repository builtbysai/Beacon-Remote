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

## Initial exploratory baseline

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

Median 269 ms; range 219–343 ms. This initial hash-based method was subsequently
replaced: compression noise can change pixels without a page transition. Do not
compare it directly with the page-recognition measurements below. A nearby receiver sample reported network RTT
59 ms, jitter buffer 14.0 ms, decode 5.5 ms, receive-to-decode 19.6 ms, no dropped
frames in the interval. These are different measurements: receive-to-decode
includes buffering and decoding, and network RTT is not tap-to-picture delay.
WebRTC counters follow the [W3C statistics definitions](https://www.w3.org/TR/webrtc-stats/).

Do not use the old harness's synthetic-event `lat` output as this baseline. The
initial exploratory samples were not adequately settled or tied to trusted mouse
events. Also avoid `uiautomator dump` during a connected session: its automation
can suppress accessibility and legitimately end sharing. Inspect before/after,
or use capture without accessibility automation while connected.

## Implemented candidates and physical results

Continuous capture currently converts each GPU texture to I420 CPU memory and
resends a cached still at intervals of 400–600 ms. The candidate shares capture's
EGL context with the session encoder, passes textures directly, and uses
`SurfaceTextureHelper.forceFrame()` to maintain output on still screens without
retaining the helper's sole in-flight texture. Authorization remains checked at
delivery. Detach drains the observer call before source disposal.

The pinned WebRTC library exposes `forceFrame`; its
[upstream implementation](https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/android/api/org/webrtc/SurfaceTextureHelper.java)
describes both forced still frames and the single in-flight texture requirement.
`15ffb6b` implements this path. Physical video output reached approximately
28–30 presented fps, including still screens. Tap latency did not demonstrably
improve; higher receiver buffering was observed. This is a continuity improvement,
not accepted end-to-end latency.

`71d187c` fixes another concrete bug: transceiver lookup compared Java sender
wrapper objects by identity. Matching their stable `id()` applies the intended
SEND_ONLY direction and H.264 preference. The pinned library exposes `id()` and
does not override sender equality. The actual Pixel changed from
`c2.exynos.vp8.encoder` / negotiated VP8 to `c2.exynos.h264.encoder` / negotiated
H.264. Receiver decode samples fell from roughly 6–9 ms to 0.7–1.3 ms.

The acceptance backend alone was recreated with its exact existing Compose chain
plus `/etc/beacon-remote/acceptance-pixel-direct-20261121.override.yaml`, setting
only `ICE_TRANSPORT_POLICY=all`. Same image/schema/credentials and four-hour bound;
production and shared relay configuration were untouched. Actual direct video
passed with host/prflx candidates and TURN still available as fallback. Direct
RTT varied approximately 43–95 ms here; direct connectivity alone did not remove
the latency.

The reusable `scripts/acceptance/visual-response.mjs` replaces changed-bit hashes.
It captures settled Device/Access heading references in browser memory and times
trusted pointer-down to a recognizable transition toward the expected heading.
It rejects indistinguishable targets and returns null on timeout. Its recognition
criterion is intentionally stronger than the initial first-changed-pixel probe.
The private `pixel-speed.mjs` harness's `bench` command runs it and writes numeric
receipts in the existing private preparation directory. Bring Beacon's main
activity to the foreground first; wait for video/control before running it.

Completed H.264 direct/headless heading-recognition run:

`424, 382, 342, 310, 344, 310, 344, 325, 281, 311, 377, 341` ms

Median 341.5 ms; range 281–424 ms. Nearby receiver sample: 27.6 fps, RTT 85 ms,
buffer 81.4 ms, decode 0.7 ms, receive-to-decode 82.2 ms. Numeric receipt:
`pixel-speed-71d187c3-direct-headless-1795301477276.json` in the private preparation
directory. This does **not**
meet the owner's immediate-response goal. The earlier GPU/VP8 direct heading run
was `289,306,280,356,311,311,364,419,322,319,294,325` ms; differing browser mode,
timing/network samples and probe implementations prevent a controlled codec
comparison. Do not claim a latency win from these samples.

Some exploratory runs closed with the interrupted browser, some were on the
phone's Home screen, and some failed the target-distinctness guard before any
sample. Those are not passing performance runs. One initial tap produced no
observed outgoing input while the next did; first-input readiness/targeting needs
a controlled reproduction before attributing it to product or fixture.

On the installed H.264 candidate, local Pause froze decoded output after one
in-flight frame (3696 → 3697, then stable). A viewer tap on Access during Pause
left the physical phone on Device. Local Resume restored frames (3741 at the
first later sample) and control. Portrait → landscape → portrait remained live
at 864×1920 → 1920×864 → 864×1920, approximately 29 fps. Original rotation settings
were restored. Browser/API Stop ended the session, the owned browser/profile
closed, and CaptureService disappeared. AvailabilityService and the explicitly
enabled StandingCaptureService remain, as expected. Thermal status was 0 in
spot checks; no sustained thermal/resource acceptance is claimed.

Validation: Android unit tests/lint/debug build passed for the texture candidate;
unit tests/lint and signed release build passed after the sender-ID change. The
web suite, typecheck, targeted lint, build, formatting and diff checks passed.
The web build retains its bundle-size warning. No Windows tests were needed or
run for these Android/web changes. Two implementation commits are local; no push
or production release was performed in this continuation.

Viewer diagnostics now calculate recent bitrate, jitter-buffer time, decode time,
receive-to-decode time and dropped frames using counter deltas. Missing counters,
new streams and intervals without decoded frames show unavailable values rather
than invented zero latency. These extra measurements remain local to the viewer.

## Remaining checks

- Establish a controlled page-recognition comparison with matched browser/network
  conditions; measure capture/encode and input dispatch separately. Receiver
  buffering remains material even with target/hint zero confirmed supported.
- Investigate input continuity: Android currently accumulates a mouse drag path
  and dispatches its gesture on release (`RemoteControl.finishStroke`), so live
  dragging cannot yet feel like direct use. Any continued-gesture implementation
  needs correct local Stop, Pause, lease loss and touch release.
- Resolve first-input observations, verify moving content and reconnect, and
  measure sustained CPU/thermal behaviour. Compare relay with the proven direct
  path under matched conditions; cellular and subjective acceptance remain open.
- Finish Pixel responsiveness before beginning the requested website redesign.

## Continuation (21-22 November, Claude)

Owner direction: connect-without-asking, smooth video and unlocking from a viewer are now one setting with no
switches to choose. Phone build `7fe90e68` (this branch): the Access tab has one "Connect without asking" switch; it
is remembered across restarts; unlocking from a viewer is always allowed; smooth video (the always-on capture) is
offered through Android's own prompt once per app launch while the setting is on and smooth video is not running,
and the availability notification says "Tap to turn on smooth video" after a restart (Android never lets an app keep
a screen capture across a restart, so one tap per restart cannot be removed). Turning the setting off stops smooth
video.

Same harness, same Pixel, relay path, smooth video on, 12 settled-heading samples each (milliseconds):

| Candidate                                                                        | Samples                                         | Median    | Presented fps | Video buffer | Network RTT | Control RTT |
| -------------------------------------------------------------------------------- | ----------------------------------------------- | --------- | ------------- | ------------ | ----------- | ----------- |
| `9d775240` baseline (Codex's work + control-RTT diagnostic)                      | 310 365 262 530 263 363 279 257 245 394 293 512 | about 301 | 59.1          | 97.4 ms      | 77 ms       | 57 ms       |
| `7fe90e68` (adds playout-delay 0 via field trial `WebRTC-ForceSendPlayoutDelay`) | 293 295 224 294 223 360 493 310 344 291 257 293 | about 293 | 59.1          | 73.0 ms      | 45 ms       | 49 ms       |
| `9d775240` with smooth video **off** (screenshots, about 3 a second)             | 688 934 509 729 994 646 512 726 773 795 510 378 | about 700 | low           | n/a          | n/a         | n/a         |

Reading: smooth video halves the response (about 700 to about 300 ms) and delivers 59 fps. Asking the browser for
zero playout delay changed the median by under 10 ms, which is inside the run-to-run noise (the network RTT also
differed between the runs), so no latency win is claimed for it; the receiver still reports 73 ms of buffering and
decode, so the browser is not honouring a zero delay (or the delay is arrival-time variance on the relay path).
The benchmark target is Beacon's own tab change on the phone, which includes the phone's own animation; a local
(no network) baseline for that same change has not been measured, so the share of the 300 ms that is network, buffering
or the app's animation is not separated. Next measurements: a local baseline, then the relay compared with the proven
direct path under matched conditions.

Phone sound (22 Nov): it is now part of sharing with no setting. Smooth-video (unattended) sessions carry an audio track
captured from the standing projection (needs Android's record-audio permission, asked together with the smooth-video
prompt; the microphone keeps its own switch). Build `a1f7abdc` on the Pixel: the viewer's statistics show the audio track
connected and receiving (1042 then 1495 packets over about 5 seconds) with level 0 because nothing was playing. A real
tone was not heard in this run (no capturable audio player could be started from adb; Chrome's own audio cannot be
captured), so audible playback in the viewer is not yet verified. The viewer now tries to unmute as soon as the
sound arrives.
