# Lab helper: see and drive the test laptop from here

`lab-agent.ps1` runs in the signed-in user's own desktop session on the test laptop (Surfiena) and does what an SSH
session cannot: take screenshots and press keys and mouse buttons. It has **no network port**. It reads command files
that the same Windows user (over the existing SSH connection) puts in `%USERPROFILE%\BeaconLab\spool\in`, and answers
next to them. A tray icon shows it is running; its menu pauses or stops it. It runs as the user, so it cannot touch
administrator (elevated) windows, the UAC prompt, the lock screen or the Windows sign-in screen.

```powershell
node scripts/lab/lab.mjs install      # copy it over and start it (per-user logon task, no admin needed)
node scripts/lab/lab.mjs ping | windows | status
node scripts/lab/lab.mjs shot --window "Beacon Remote" --out host.png     # that window only, even if covered
node scripts/lab/lab.mjs click 640 480 --window "Beacon Remote"
node scripts/lab/lab.mjs type "text" --window "Beacon Remote"
node scripts/lab/lab.mjs key ctrl+s --window "Beacon Remote"
node scripts/lab/lab.mjs launch C:/path/to.exe arg1 arg2 | put local remote | get remote local
node scripts/lab/lab.mjs pause | resume | stop | uninstall
```

Safety rules built in: keyboard input must name a target window, which is raised and checked to have the focus before
anything is sent (otherwise nothing is sent); a click with `--window` must land inside it; a `PAUSE` file or the tray
menu refuses all input and screenshots; every command is logged to `agent.log` (typed text is never logged, only its
length); the spool folder is limited to the user, SYSTEM and Administrators.

Known limits: some store apps (the Calculator) ignored injected keys in testing; screenshots of a covered window use
`PrintWindow`, which a few apps draw stale. Use classic windows (the Beacon host and card) for automation.

## The direct cable (set up November 25, 2026)

The development computer and the test laptop are joined by an Ethernet cable (USB adapter on the laptop). The wired link
is `10.77.0.1` (development computer, `Ethernet 2`) and `10.77.0.2` (laptop, `Ethernet 3`), /24, no gateway or DNS, a
high interface metric so it never carries internet traffic. Round trip about 1 ms; the Tailscale route goes through a
relay at about 35 ms (Tailscale did not switch to the wired path, cause unknown), so `lab.mjs` uses the SSH alias
`beacon-surfiena-link` when it answers and falls back to `beacon-surfiena`.

Each step needed administrator approval on the machine it changes, and is reversible with the same script:

| Script (run elevated)                                                            | What it changes                                                                                                                                                                                                                                      | Undo                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `Set-LabLink.ps1 -Address 10.77.0.x`                                             | Fixed address on the cable's adapter only                                                                                                                                                                                                            | `Set-LabLink.ps1 -Remove`  |
| `Allow-LabSsh.ps1 -DevTailscaleAddress <this PC's Tailscale IP>` (on the laptop) | A firewall rule for TCP 22 from 10.77.0.1 to 10.77.0.2 on that adapter; a second sshd `ListenAddress`; 10.77.0.1 added to the sshd `Match ... Address` exception and to the key's `from=` list. Backups: `*.before-lab-link` in `C:\ProgramData\ssh` | `Allow-LabSsh.ps1 -Remove` |

SSH on the laptop stays limited to this one development computer (by its Tailscale address and now its cable address),
key only, no passwords. The laptop also had its battery sleep timeout raised from 5 to 60 minutes (plugged in it never
sleeps). The helper restarts itself within ten minutes if it ever stops (`BeaconLabAgent-watch`).

## Seeing and driving the laptop through Beacon itself

This runs the real product end to end: a local test server on the development computer, a Windows host on the laptop
paired to it, and the web viewer here. Verified November 25, 2026 over the cable: 720p at 29 fps, 4 ms round trip,
clicks and keys from the viewer reached a laptop window, the viewer's End closed the sharing card.

1. **Test server** (loopback only, throwaway schema, media and control on, account and pairing code written under
   `D:/Beacon-Secrets/remote/local/`): `pnpm dev:setup` once (needs Docker Desktop), then
   `pnpm --filter @beacon-remote/backend exec tsx scripts/lab-development.ts` (backend 3012, web 5176).
2. **Tunnel**: `ssh -N -R 127.0.0.1:3012:127.0.0.1:3012 -o ExitOnForwardFailure=yes beacon-surfiena-link`. The host only
   allows plain HTTP to its own loopback address, so the laptop's `127.0.0.1:3012` reaches the server through SSH.
3. **Host on the laptop**: build `cargo build --release -p beacon-remote-agent -p beacon-remote-session`, copy the three
   `beacon-remote-{agent,host,session}.exe` to `C:\Users\<lab user>\BeaconLab\builds\lab\`, pair with the agent's stdin
   prompts (server `http://127.0.0.1:3012`, a name, the code from `state/lab-development/pairing.json`), then start the host
   with `LOCALAPPDATA` pointed at `builds\lab\profile` so it never touches the laptop's real identity.
4. **Keep media on the cable**: ICE can otherwise nominate the Wi-Fi or the Tailscale relay (30-40 ms, throttled) and the
   video never decodes. `Limit-LabMediaToCable.ps1` (elevated, once) drops the lab session helper's _inbound_ UDP from every
   address except the cable's 10.77.0.x and loopback. Inbound on purpose: a blocked outbound send fails with an access
   error and the helper stops with "Media consumer stalled".
5. **Viewer**: sign in at `http://127.0.0.1:5176` with the test account from `accounts/lab.json`, press Connect on the
   computer, and the person at the laptop answers the request card (or sets trusted access in the host's More options).

The laptop's own approval is part of the product and is never bypassed by the tooling. For unattended runs the owner set
the lab host to trusted access (`beacon-remote-agent access trusted --control` with `LOCALAPPDATA` on the lab profile, or
More options in the host); the sharing card with Stop still appears and Stop, sign-out and revocation still end the
session. Back to asking every time: `... access attended`.

Input safety: the viewer sends keys to whatever window is in front on the laptop, and the person may have their own
chat or documents open there. Raise a window you own with `lab.mjs raise`, confirm with `lab.mjs foreground`, then type.
Use key presses (`key e c h o ...`), not text insertion, which the viewer does not forward.
