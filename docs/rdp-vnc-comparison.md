# RDP and VNC comparison: what is measured and what is not

Status as of November 18, 2026. This page does not claim Beacon Remote is better
than RDP or VNC. It records the Beacon numbers measured so far, the comparisons
that cannot be made yet, and the method to follow when they can. See the
[parity roadmap](rdp-vnc-parity-roadmap.md) for the capability plan.

## Measured for Beacon Remote

All runs used the acceptance server and the relayed route (browser and device
both forced through TURN), one sample unless noted, from the build named. They
show the system works at these figures, not typical or best-case performance.

| Device                                      | Build     | Result                                                                                                                                                                                       |
| ------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfiena (Windows 11 Home, 2736x1824 panel) | `03d649a` | View only through the relay: 406 frames in 15 s, 27.6 FPS presented, 57 ms round trip, 1280x720 video.                                                                                       |
| Surfiena                                    | `712b719` | Control request up front reached the input channel; 19.1 FPS and 111 ms round trip in the first seconds of a session.                                                                        |
| Surfiena                                    | `712b719` | Host reported online 317 ms after launch (presence ready), no click needed.                                                                                                                  |
| Pixel 7a (Android 16)                       | `99d3739` | View only: 576x1280 video, 58 ms round trip, approval to first frame 689 ms; 2 to 22 FPS depending on screen activity. Control session: 123 ms round trip, first frame 1.6 s after approval. |

File transfer (the same 3 MiB test file, SHA-256 checked at the receiver): Pixel
received it intact on November 18; Surfiena received it intact on November 18.

## Not measured

- Input-to-photon latency, encode cost, CPU and memory on the host, bandwidth and
  reconnect time. Nothing in this repository measures these against a reference.
- Any RDP or VNC figure. Surfiena runs Windows Home, which cannot host Microsoft's
  RDP, and no licensed Pro, Enterprise or Server reference machine has been used.
  No VNC server has been run for comparison.
- Direct (non-relayed) routes, packet loss, high-latency links, high-motion video,
  4K or multi-monitor setups, and battery or thermal impact on the phone.

## Where Beacon differs by design, not by measurement

These are design properties, not proven advantages:

- Every attended connection needs visible local approval on the device, and
  sharing shows a persistent indicator with Stop. RDP and VNC deployments are
  commonly configured to connect without that prompt.
- Sessions are view-only unless the person at the device allows control, and
  extra access (files, shared folder, printing, recording) is approved separately
  and ends with the connection.
- Nothing needs a client install: the viewer is a web page.

Where RDP and VNC are ahead today: independent per-user Windows sessions,
RemoteApp, USB and smart-card redirection, mature clipboard and audio, and
decades of hardware-accelerated codec work. See the roadmap for what remains.

## Method for the real comparison

1. Use the same two machines, one Windows Pro or Enterprise host with RDP enabled
   by its owner, and one Windows client, on the same network for every run.
2. Run each tool for the same scripted tasks: reading text, scrolling a long
   page, typing a paragraph, dragging a window, playing a 1080p video clip.
3. Record per task: time from click to first usable frame, input-to-photon
   latency (high-speed camera or a screen-timer method), presented FPS, host CPU
   and memory, and bandwidth, at least five runs each, reporting the median and
   spread.
4. Repeat on a direct route and on a relayed route, and with 50 ms and 150 ms of
   added latency and 1% loss.
5. Publish the raw numbers with the build, hardware and settings used. Only then
   decide whether any "better than" statement is supportable, for which tasks.
