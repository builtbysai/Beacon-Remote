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

## Incoming-request notification (next host build)

- [ ] With the host running in the tray, request the computer from the workspace: a Windows notification says who is
      asking and whether it is to see or to control; the consent window is also in front. With trusted access it
      says the connection needs no approval. Nothing happens if Focus Assist is on (the consent window still shows).

## 7. Android phone as a host (view only)

Build `apps/android-host` (`gradlew :app:assembleDebug`) and install the debug APK; it is not published yet.

- [ ] In the workspace choose Add a computer; in the app enter the server, a name and the code. The phone appears
      online in Computers.
- [ ] View it from the web: the phone shows "Request to see your screen" naming who is asking. Decline works.
- [ ] Allow once, then accept Android's own prompt: the picture appears in the viewer, Android shows its sharing
      chip, and the notification offers Pause and Stop (also on the lock screen).
- [ ] Pause shows the pause banner in the viewer; Resume clears it; Stop ends the session and the notification.
- [ ] Switch the phone from Wi-Fi to mobile data during a session; lock the screen; check what happens.
- [ ] Control: in Settings, Accessibility, turn on Beacon Remote control. In the workspace choose Remote for the phone.
      The request screen shows an unticked "Also let them touch and type on this phone". Leave it unticked: the viewer
      says view only and shows no phone buttons. Request again and tick it: the viewer shows Back, Home and Recents;
      tapping, dragging, scrolling and typing in a text field work; the notification says "Sharing and being
      controlled"; Pause stops all input and Resume restores it.
- [ ] Restart the phone: it is available again without opening the app. After Stop being available, a restart
      leaves it unavailable.
- [ ] Remove this phone in the app and in the workspace; it can no longer be reached.

## 8. Signed installer and trusting the certificate

- [ ] Run `BeaconRemoteSetup-<commit>.exe` on a computer that does not trust the certificate. It offers once to
      trust it and shows a fingerprint; compare it with the Downloads page. Choose Yes, approve the Windows
      administrator prompt: Beacon Remote installs, and `Get-AuthenticodeSignature` on the installed programs says
      Valid.
- [ ] Run the installer again: it does not ask again.
- [ ] On another computer run `Trust-BeaconRemote.ps1 -Fingerprint <the Downloads page value>`; run it a second time
      and it says "Already trusted". `-Status` reports it; `-Remove` takes it away.
- [ ] Publish a newer build and let an installed host update itself: the new programs are still signed.
- [ ] Uninstall: it offers to stop trusting the certificate.

## 9. Team

- [ ] With two accounts: in Settings, Team add the second as a viewer for all computers. On the second account, Assist
      lists your computers under "Shared with you" with your email and "team access"; View works and asks on the computer.
- [ ] Change them to a technician for one group: only that group's computers remain and Control is offered.
- [ ] Give another computer that group in its settings: it appears for the technician without any further step.
- [ ] Remove them: the shared computers disappear and a live session they had ends.

## What to send back

For anything that felt off: the time, what you did, and the session's row from Sessions (the Connection column).
If a path failed (for example Relayed when Direct was expected), also say which networks the two devices were on.

## Not enabled yet (blocked on you)

- Email sign-up and recovery by email: needs a Remote-specific Resend API key and sender address
  (`RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_SIGNUP=true` in `/etc/beacon-remote/production-media.env`).
- Authenticode signing: needs a code-signing certificate. Until then the installer and programs are unsigned.
