# Hardware video encoding: how it is chosen and what has been proven

## How the encoder is chosen

`apps/windows-session/src/encoder.rs` asks Windows Media Foundation for hardware H.264 encoders (`MFTEnumEx` with the hardware flag, sorted by
the system's own preference), tries each in turn, and only trusts one after it has been activated, accepted the settings (Baseline, low
latency, no B-frames) and produced output for a few blank frames. The first that passes is used. If none does, the inbox software encoder is used.
Nothing looks at the GPU vendor's name: Intel Quick Sync, NVIDIA NVENC and AMD's encoder all appear to Windows as Media Foundation transforms
when their drivers provide one, so the same code path serves them. `BEACON_SOFTWARE_ENCODER=1` forces software. The choice is printed in the
session log ("Hardware H.264 encoder unavailable (...); using software." or the hardware line), and the viewer's quality tier logic (ADR on adaptive
quality) uses the measured encode cost, so a slow encoder lowers the tier instead of stalling.

## What has been proven

| Hardware                                                                                        | Result                                                                                               |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Intel Iris Xe (the owner's PC)                                                                  | Hardware encoder used, low CPU, measured earlier (see the milestone record in `docs/roadmap.md`)     |
| NVIDIA (NVENC)                                                                                  | **Not tested.** Expected to work through the same path; do not claim it until the check below passes |
| AMD                                                                                             | **Not tested.** Same                                                                                 |
| Older Intel (pre-Quick Sync H.264 async MFT), no GPU, Remote Desktop sessions, virtual machines | Software fallback is the designed result; confirm with the check below                               |

## The check to run on any computer

On the computer, from the install folder or a build:

```powershell
beacon-remote-session.exe encoder-benchmark
```

It prints how many hardware H.264 encoders Windows advertises and benchmarks the one in use with synthetic frames (no screen capture). Record,
for each computer: GPU and driver, the "Advertised hardware H.264 encoders" count, whether it says HARDWARE or inbox software, the frame time and
the CPU use. Then a real session (view, 5 minutes, moving content) and the session history's measured frame rate, delay and loss
(Sessions page). A computer passes if hardware is chosen when advertised, or software runs without stalling when not, and a forced
`BEACON_SOFTWARE_ENCODER=1` run also works. Add a row to the table above only with those numbers.

## Not done

Choosing an encoder by measured throughput rather than the system's order, HEVC or AV1, and hardware capture paths that avoid the GPU-to-CPU
readback. Each needs hardware to measure first.
