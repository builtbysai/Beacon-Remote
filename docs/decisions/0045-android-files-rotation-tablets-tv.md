# 0045: Android host: receiving files, turning the phone, tablets and TV

Status: accepted, 2026-10-14

## Decision

- **Receiving files.** The consent screen has an unticked box, "Also allow receiving files (saved in Downloads/Beacon Remote)", shown on
  Android 10 and newer. Only when it is ticked does the phone create the `beacon-files-v1` channel (ADR 0031), so a helper that was not
  allowed to send files has nothing to send to. A file goes into `Downloads/Beacon Remote` through MediaStore as a pending item, never
  replaces another file (Android numbers a repeated name), becomes visible only when its length and SHA-256 match, and is deleted if
  it fails, is cancelled, sharing is paused, or the channel closes. One file at a time, 2 GiB each and 4 GiB a session; names are reduced to
  one safe component. Sending files from the phone and resuming interrupted uploads are not supported on Android.
- **Turning the phone.** The session watches the default display. When its size changes (rotation, or a resolution change) it resizes the
  capture (`changeCaptureFormat`), remaps control to the new size and sends the viewer a new `display` message. The viewer now accepts a
  later `display` message that replaces the size (before, a second one was an error), which also serves a Windows monitor that changes
  resolution.
- **Tablets and Android TV.** The app declares the touch screen and leanback features as not required, and adds a TV launcher entry and a
  banner, so it installs on tablets and TVs. A TV has no touch screen and no accessibility control worth offering: it is view only there, and
  the request screen works with a remote's D-pad.

## Checked

On the Android 16 emulator against a local server: the consent box, a 3 MB file arriving with an identical hash, no files channel when the box is
unticked, and the picture switching from 576x1280 to 1280x576 and back as the phone rotates. Not checked: a real phone, a TV, Android below 10
(where the box is not shown), very large files, low-memory phones.
