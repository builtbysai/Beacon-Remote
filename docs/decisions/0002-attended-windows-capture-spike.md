# ADR 0002: Attended primary-display capture before media transport

Status: development implementation; initial real-machine capture and deadline
shutdown verified. Cancellation and device-loss acceptance remain pending.

Use Windows Graphics Capture through the MIT-licensed `windows-capture` 2.0.1
crate for the first native capture slice. Its maintained native API wrapper
avoids duplicating COM/D3D lifecycle code; its screen capture and frame buffer
interfaces remain isolated inside the interactive session helper. No audio,
video encoder, file output, or network upload is invoked by this spike.

The development helper asks for explicit local consent through a visible Windows
dialog, then captures only the primary display with a mandatory Windows border
and cursor. It stops after ten seconds or Ctrl+C, retains one bounded BGRA frame,
and implements the core snapshot interface independently of a browser player.
Use per-monitor DPI awareness and physical display coordinates. Refuse frames
over 64 MiB rather than allocate an unbounded queue on older machines.

This is a measured capture spike, not remote access or an installer. Real-machine
acceptance must verify the border, cancellation, stop, dimensions, DPI, CPU,
memory, first-frame latency, and update rate. Constant encoder cadence, GPU-native
encoding without readback, display changes, and secure session authorization are
later work. Source: [upstream library](https://github.com/NiiightmareXD/windows-capture).

The initial host measurements and remaining limitations are recorded in
[validation](../validation.md). They support continuing the media spike, not a
claim that remote access is complete.
