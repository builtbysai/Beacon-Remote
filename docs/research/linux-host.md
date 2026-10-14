# Linux host: feasibility and first vertical slice

Status: research, 2026-10-14. Nothing here is built. It needs a Linux machine to verify; the plan is written so the first
slice can be tried on any Ubuntu or Fedora desktop and a Raspberry Pi.

## What has to be true

The host does what the Windows host does, with the same protocol and the same server: pair or claim, report presence,
wait for a request, show a consent window naming the person, capture the approved display, take input only if control was
approved, show a visible sharing indicator with Stop, and end everything on Stop, pause, expiry or revocation. The control
plane, authorization, recording, files and chat do not change; only the platform layer does.

## Capture and input by display server

| Display server | Capture                                                                                            | Input                                                                                                                  | Consent                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X11            | XSHM or XCOMPOSITE through `x11rb`; XFIXES for the cursor image; RandR for monitors                | XTest (`xtest` extension) for pointer and keys                                                                         | Ours: the same local Allow window as Windows. X11 has no isolation, so nothing else gates it.                                                                           |
| Wayland        | `org.freedesktop.portal.ScreenCast` returns a PipeWire stream; the compositor shows its own picker | `org.freedesktop.portal.RemoteDesktop` (pointer, keyboard) on the same session; libei where the compositor supports it | The compositor's own prompt is the approval. Our window can still name the person first, but the portal decides and may be declined or revoked by the user at any time. |

Wayland needs no extra privilege and cannot be bypassed, which is the right model, but it means:

- Unattended access is not promised. Some portals offer a restore token so a previously approved source can be reused,
  but behaviour differs by compositor and version (GNOME, KDE, wlroots) and by whether the machine is at a login screen.
  The product treats Wayland as attended unless a token is verified to work on that machine.
- Control through the portal is only available where the RemoteDesktop portal is implemented. Where it is not, the host
  offers view only and says why.
- The display list comes from the portal's source selection rather than from enumeration, so "which display" is a
  portal choice, not ours.

## Components

- A Rust program `beacon-remote-host-linux`, reusing `beacon-remote-core`, the signed presence loop and the WebRTC code from
  `apps/windows-session` (capture, encoder, media, files, consent state are the platform parts to split out behind a trait).
- Portals through the `ashpd` crate; PipeWire frames through the `pipewire` crate; X11 through `x11rb`.
- Encoding: software H.264 first (openh264 or x264 through GStreamer), then VA-API/NVENC through capability detection on
  the machine, never assumed from the GPU vendor (same rule as Windows).
- A small consent and sharing window in GTK4 (Wayland and X11), with the same wording and the same Stop. A tray icon where
  the desktop has one; GNOME needs an extension for tray icons, so the window must work without it.
- Credentials: the identity key in the Secret Service (libsecret) where there is one, otherwise a file readable only by the
  user. No root daemon: like the Windows host, it runs as the signed-in user, started by a systemd user unit the person turns
  on (`systemctl --user enable`), which is the Linux equivalent of the Run key.
- Packaging: a `.deb` and an `.rpm` or one AppImage, signed with the same update-signing key; updates through the same signed
  feed. Raspberry Pi OS (64-bit, Wayland by default on recent releases) uses the same package for `aarch64`.

## First vertical slice

Install, pair with a code, appear online, request approval, view the desktop, control it, stop. Concretely:

1. X11 first (fastest to prove the protocol end to end): `x11rb` capture, software encode, XTest input, GTK consent window.
2. Wayland view through the ScreenCast portal on GNOME and KDE.
3. Wayland control through the RemoteDesktop portal.
4. Packaging and the user unit; then hardware encode.

Acceptance needs a real Ubuntu (GNOME, Wayland), Fedora (GNOME), a KDE machine, and a Raspberry Pi 4 or 5. Android TV is a
separate track (it is Android: the Android host with a leanback interface and no touch input).

## Risks to check early

- GNOME's portal prompt cannot be pre-approved headlessly: confirm the attended flow is acceptable before any unattended claim.
- PipeWire frame formats (DMA-BUF versus shared memory) and their conversion cost on a Pi.
- Games and Flatpak/Snap sandboxes: capture of a sandboxed app is whatever the portal exposes.
- Keyboard layouts: send key codes plus the layout, not characters, to keep non-US keyboards correct.
