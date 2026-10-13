# Real-device acceptance checklist

For the owner's hands-on testing. CI and local runs cannot prove these; each line needs a real computer, phone or
network. Every session now records measured quality (route, picture height, frames per second, round-trip time,
packet loss) every 15 seconds, shown under **Sessions → Connection**, so you only need to note what felt wrong and
when: the numbers are already saved.

Download the installer from the Downloads page (unsigned: Windows will warn once; choose More info, then Run
anyway). Uninstall from Apps and features; that also removes the saved sign-in.

## 1. Install and pair

- [ ] Double-click the installer. The Beacon Remote window opens; the Start menu has a shortcut.
- [ ] Pair with Add a computer in the workspace. The computer shows online within a few seconds.
- [ ] Restart Windows. The host starts at sign-in and the computer comes back online without opening anything.
- [ ] Uninstall, then check the computer is gone from Apps and features and `%LOCALAPPDATA%\BeaconRemote` is empty.

## 2. Viewing and control (different network from the computer)

- [ ] View from a phone on mobile data and from a laptop on another Wi-Fi. Note the route in Sessions: Direct or
      Relayed. Both must work.
- [ ] Move the mouse, type, scroll, use shortcuts (Ctrl+C, Alt+Tab), paste into and copy from the computer.
- [ ] Play a video or scroll a long page for two minutes. Quality should settle without freezing; the Connection
      column shows the resolution and frame rate it settled on.
- [ ] Full screen on the phone (landscape) and touch gestures; trackpad mode and touch mode.
- [ ] Lock Windows (Win+L) while sharing, then unlock. Check what the viewer shows and that control resumes only
      as approved.
- [ ] Open a UAC prompt and note what the viewer shows. The secure desktop is never captured or controlled by design.

## 3. Interruptions

- [ ] Switch the viewer phone from Wi-Fi to mobile data mid-session. The picture should recover on its own in
      seconds, without a new Allow.
- [ ] Turn the computer's Wi-Fi off for 20 seconds and on again.
- [ ] Sleep the computer and wake it. The session should end cleanly or resume only if policy allows.
- [ ] Close the viewer tab and reopen the workspace: the running session is offered again.
- [ ] Stop from the computer (Stop sharing) and from the web (Stop viewing): both end at once, and any held key or
      mouse button is released.
- [ ] Pause sharing on the computer: the viewer goes blank and input is ignored until Resume.

## 4. Access modes

- [ ] Attended: every connection asks Allow once; Decline works.
- [ ] Trusted: turn it on in the host window, connect from your account without a prompt; lower it from the web
      and check the session ends within seconds.
- [ ] Support code (the computer issues it): redeem on the Support page without an account; the computer still asks.
      The consent window names the helper "Guest helper (no account)".
- [ ] Remembered helper with and without the Allow.

## 5. Files

- [ ] Tick "Also allow receiving files" in the consent window; Send file and drag-and-drop from the viewer; the file
      lands in `Downloads\Beacon Remote`, opens with a Windows warning (it came from the internet).
- [ ] In the sharing window choose Send a file…; the helper's browser offers it and saves it after Save.
- [ ] Cancel a large transfer midway: no partial file is left on either side.
- [ ] Without the box ticked, no Send file button appears.

## 6. Recording and groups

- [ ] Tick "Also allow the helper to record this session" in the consent window; the viewer shows Record. While it
      records the computer's sharing window says so, and stopping saves a video file in the viewer's browser.
- [ ] Without the box there is no Record button.
- [ ] Give two computers a group in the inspector (edit, Group) and use the All groups filter.
- [ ] On the computer with a graphics card, check the helper's CPU in Task Manager while viewing at 1080p. It uses
      the graphics card's H.264 encoder when it works and falls back to software on its own.

## What to send back

For anything that felt off: the time, what you did, and the session's row from Sessions (the Connection column).
If a path failed (for example Relayed when Direct was expected), also say which networks the two devices were on.

## Not enabled yet (blocked on you)

- Email sign-up and recovery by email: needs a Remote-specific Resend API key and sender address
  (`RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_SIGNUP=true` in `/etc/beacon-remote/production-media.env`).
- Authenticode signing: needs a code-signing certificate. Until then the installer and programs are unsigned.
