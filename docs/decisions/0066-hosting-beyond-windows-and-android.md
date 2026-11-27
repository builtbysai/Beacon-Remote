# 0066: Hosting on Linux, Raspberry Pi and macOS

Status: proposed November 27, 2026. Design only: nothing here is built and no claim is made about performance or
behaviour on those systems. It covers the "Linux and Raspberry Pi hosting; macOS only with native permissions" part of
roadmap M8. It builds on [0051](0051-independent-sessions-native-versus-gateway.md) (native first) and the identity rules of
[0061](0061-peer-authentication-above-signaling.md) and [0062](0062-computer-key-change-and-recovery.md).

## What a new host must do

The same few things the Windows and Android hosts do, and nothing more: enroll once and hold a key that cannot simply be
copied to another machine; report presence; on an approved request capture the screen it is allowed to capture and send it
over WebRTC; accept input only under a live lease; show that sharing is on and let the person here Stop it; honour the
same data-channel permissions (control, files, clipboard, drive, print, screen structure) each behind its own local
approval. The shared pieces are `crates/remote-core` and the protocol package; each system adds only its own capture, input,
indicator, key storage and packaging, in the same split as the Windows agent (identity and presence) and session helper
(capture and input, run in the user's own session).

## Decisions proposed

1. **Linux, X11 first.** On X11 the session helper captures with the usual shared-memory screen grab and injects input
   through the XTest extension, both as the signed-in user with no extra privilege, so unattended access works the way it
   does on Windows. No `/dev/uinput`, no root helper: that would be a privileged input path with its own review (see 0063).
2. **Linux, Wayland through the desktop portals only.** Wayland gives a program no right to read the screen or press keys. The
   only supported route is the ScreenCast and RemoteDesktop portals, where the compositor itself asks the person and shows
   its own indicator. Unattended access is therefore limited to what the compositor's remembered permission allows; where it
   cannot be remembered, the host says "needs someone at the computer to approve" and never works around it.
3. **Raspberry Pi is Linux on ARM, not a separate product.** The same host, built for 64-bit ARM, using the board's hardware
   video encoder where the system exposes one and a software encoder where it does not. No frame-rate or latency figure is
   promised before it is measured on real boards.
4. **macOS last, and only through the system's own permissions.** Capture needs the Screen Recording permission and input
   needs Accessibility; both are granted by the person in System Settings and cannot be granted by Beacon. A managed fleet may
   pre-grant them through its device-management profile; Beacon never tries to bypass that system. A user-session helper
   cannot see the login window, so macOS gets no sign-in-screen feature and says so.
5. **Keys stay where they cannot be lifted by copying a profile.** macOS Keychain; on Linux the desktop's secret service when
   there is one, otherwise a file readable only by the user, with the weaker guarantee stated in the host window. A restored
   image enrolls again as a new computer (0062).
6. **Presence is a per-user service by default.** A systemd user unit on Linux and a launch agent on macOS. A system-wide
   presence service (before anyone signs in) reports presence only and captures nothing, as the Windows boot service does.
7. **Packaging is a decision for the owner, not housekeeping.** Linux packages signed with the release key are free to
   produce. macOS distribution to other people needs an Apple developer account and notarization, which is paid
   infrastructure; until the owner decides, macOS builds are for the owner's own machines.

## Order and evidence

Linux X11, then Wayland, then Raspberry Pi, then macOS. For each: the protocol conformance tests the Windows host already
passes; capture and input tests under a virtual X server in CI for X11; and, for Wayland, Raspberry Pi and macOS, a recorded
run on real hardware before any claim is made. Nothing is announced as supported until that run is recorded in
`testing-remaining.md`.

## Not decided here

Distribution channels and their signing, audio and clipboard details on each system, whether a Linux distribution with
neither X11 nor a portal is supported at all, and any multi-user or multi-seat behaviour (0051 defers it).
