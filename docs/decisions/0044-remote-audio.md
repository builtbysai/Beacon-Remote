# 0044: Sharing the computer's sound

Status: accepted, 2026-10-14

## Context

Some support needs the helper to hear the computer (a video that will not play, an alert, a call). Sound leaves the room, so it is a
separate permission from seeing the screen, and a microphone is a different and more sensitive thing again.

## Decision

- **What is shared.** Only what the computer is playing through its default speakers (Windows loopback capture). A microphone is
  never opened and there is no setting to open one.
- **Permission.** The consent window has its own box, off by default and independent of view, control, files and recording:
  "Also share this computer's sound (the helper hears what plays here)". Sessions that skip the window (the owner's own trusted
  access) never carry sound. The sharing indicator says "Sound shared" for as long as it is on, next to the other permissions.
- **How.** When the box was ticked the host negotiates an Opus audio track next to the video (48 kHz stereo, 64 kbit/s, 20 ms
  packets). Capture runs only while the viewer is connected, sharing is not paused, the lease is valid and the session is
  active, exactly like the video, and stops the moment any of that stops. Without the tick no audio is negotiated at all.
  Silence is sent as silent frames, so the stream's clock stays steady while nothing plays.
- **The viewer.** The audio joins the picture's stream but stays muted until the viewer chooses "Sound on", because browsers do
  not let a page start sound unprompted. Recording a session records whatever the viewer received, sound included, which is
  announced on the computer as for any recording.

## Not done

Mixing the helper's voice back to the computer (there is no two-way voice; use chat), choosing a different output device, sharing the
sound of one application only, and sound for trusted sessions (it would need its own local setting).

## Build note

The Opus codec is compiled from source with CMake. Building the session program needs CMake on the PATH (Visual Studio's own copy,
or the Windows runners' preinstalled one). `scripts/Build-DevelopmentHost.ps1` finds Visual Studio's copy when CMake is not already
there.
