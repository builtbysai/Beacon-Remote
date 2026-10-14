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

## 10. One-click temporary support (next published build)

Use a second Windows PC (or a spare account) that does not have Beacon Remote installed.

1. In Assist choose **New support session**, copy the link and open it on the other PC. The page names your account and
   what you asked for.
2. Download and open the support program. Windows may warn about the publisher. Check the question names you, choose Yes.
3. The computer appears in your Support sessions as ready. Choose View. The other PC shows the usual connection
   request; Allow it. You see the screen.
4. End it three ways on three runs: **End support** on the other PC; **End support** on your side; close the program's
   window. Each time: sharing stops, the entry shows Finished, and
   `%LOCALAPPDATA%\BeaconSupport` and the downloaded file are gone, and Beacon Remote is not in Apps and features.
5. Run it again and, while support is active, end the support window from Task Manager, then (another run) restart the
   other PC. Support comes back (a visible window saying it is resuming) and the entry returns to ready. Then End support:
   everything is removed.
6. Untick "Remove Beacon Remote when support ends" once: the sign-in goes, the programs stay.
7. Open a used or cancelled link: the page says it cannot be used.

## 11. Newer features on the second computer

Run `node scripts/acceptance/support.mjs --login <file> --device ssh:user@host` first (docs/testing.md); it covers the temporary-support
journey. These need a person:

- [ ] **Sound.** Allow a view session and tick "Also share this computer's sound". Play a video on that computer; choose Sound on in
      the viewer and hear it. The sharing window says "Sound shared". Allow another session without the box: no Sound button.
- [ ] **Two displays.** With a second monitor, the viewer shows a Display menu. Choose the other display: the computer is asked again
      and names that display; the picture changes. Unplug the monitor: the menu loses it.
- [ ] **Wake.** Put a computer to sleep (wired, wake-on-LAN enabled in its firmware and network card settings). With another of your
      computers awake on the same network, its panel offers "Wake this computer"; it wakes within a minute.
- [ ] **Restart.** For a computer that trusts your account with control, "Restart computer…" shows Windows' 30-second countdown on it;
      `shutdown /a` there cancels it; otherwise it restarts and comes back after sign-in.
- [ ] **Remove.** "Uninstall and remove…" on an online computer: it says on screen that you removed it and Beacon Remote is gone from
      Apps and features. On a computer that is off: it stays revoked, and removes itself when switched on within 30 days.
- [ ] **Large file.** In Chrome or Edge, accept a 1 GB file from the computer: it streams to the place you choose, and cancelling leaves nothing.
- [ ] **Resume.** Send a 200 MB file to the computer, turn Wi-Fi off for ten seconds mid-way, turn it back on: the transfer says
      "Resuming" and finishes with the right checksum (compare the file's SHA-256).
- [ ] **Self-hosting.** On a small VPS with a real domain, follow docs/self-hosting.md end to end, including a backup and restore.

## What to send back

For anything that felt off: the time, what you did, and the session's row from Sessions (the Connection column).
If a path failed (for example Relayed when Direct was expected), also say which networks the two devices were on.

## Not enabled yet (blocked on you)

- Email sign-up and recovery by email: needs a Remote-specific Resend API key and sender address
  (`RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_SIGNUP=true` in `/etc/beacon-remote/production-media.env`).
- Authenticode signing: needs a code-signing certificate. Until then the installer and programs are unsigned.
