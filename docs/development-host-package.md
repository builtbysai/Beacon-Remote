# Unsigned per-user development host

Build on Windows with the existing MSVC/Windows SDK setup:

```powershell
./scripts/Build-DevelopmentHost.ps1
```

The command requires committed native source, runs the native validation/build,
and packages the matching agent/helper, explicit installer, launcher and
uninstaller under `dist/BeaconRemoteDevelopment-<commit>.zip`. Existing output is
preserved. The manifest records the native source commit and payload SHA256;
these hashes detect corruption and are **not publisher authentication**.

This is an internal development installer. Extract it and inspect `README.txt`
and `Install.ps1`. Run only through the normally approved PowerShell environment.
Never bypass SmartScreen, UAC or execution policy. Unsigned scripts may be blocked
by local policy; signing/distribution remains a separate gate.

Installation copies into the current user's
`%LOCALAPPDATA%/Programs/BeaconRemoteDevelopment` and creates Host and Uninstall
Start menu shortcuts. Host opens a native pairing/status window with a tray icon.
Pairing uses the real one-use enrollment code and DPAPI identity path. Start host
reports signed presence and dispatches the matching interactive consent/helper.
Stop host, Quit and closing the window cancel presence and tell the helper to
stop through its private anonymous stdin pipe; shutdown waits for helper cleanup.
Minimize leaves a tray icon with Show, Stop host and Quit. The host clears
development capability/duration flags. Stop it before uninstalling.

Plain uninstall preserves pairing identity and unknown files. Revoke the computer
in Beacon Remote first, then explicitly run the installed `Uninstall.ps1
-ForgetIdentity` to remove the current user's local identity too. No credentials
are carried in the archive, manifest, shortcut arguments or command lines.

The package provides no Windows service, service IPC, startup/reboot recovery,
automatic updates or rollback. Those remain independent installation
work. It does not enable production media/input or claim consumer readiness.

Acceptance: verify payload hashes and tamper refusal, install into an isolated
test profile, inspect shortcuts, execute the matching binaries' help, uninstall
and confirm only owned files/shortcuts are removed. Separately verify real
install → account/pair → presence → attended view → local Stop → revoke →
identity removal on an owner test machine. Packaging checks alone do not prove
that latter journey or reboot recovery.

2026-10-12 workstation evidence: native formatting, Clippy, regressions and
release build passed. The generated package installed in an isolated profile;
The earlier console package's Pair/Run/Uninstall shortcut targets and both installed executable help commands
were verified. Uninstall removed owned files/shortcuts and preserved an unknown
file. Altered payload was rejected before any installation directory was created.
No live pairing identity was installed or removed during that check.
