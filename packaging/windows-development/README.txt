Beacon Remote — unsigned internal Windows development host

This is a per-user development installer, not a consumer/service release.
Inspect the source and manifest. SHA256 detects damaged files; it is not a
publisher signature. Do not bypass SmartScreen, UAC or PowerShell policy.
If your policy blocks unsigned scripts, use an approved signing/testing process.

1. Extract this archive into a directory you own.
2. Run Install.ps1 through your normally approved PowerShell environment.
3. Start menu > Beacon Remote Development > Host. Enter your Beacon Remote
   server origin and a fresh pairing code from Computers > Add a computer.
   Credentials and pairing codes are never supplied on command lines.
4. Select Start host. The native window and tray show actual connection status.
   Every attended desktop connection still needs local Allow and has local Stop.
5. Use Stop host or Quit. Closing the window also stops the host; minimize keeps
   it in the tray only when a tray icon is available. Shutdown waits for its
   attended helper to release input and stop sharing. No logon startup is installed.
6. Revoke the computer through Beacon Remote. Run installed Uninstall.ps1 with
   -ForgetIdentity to remove this user's DPAPI-protected pairing identity too.
   Plain Uninstall preserves identity for deliberate reinstall and leaves
   unrecognized files alone. Stop the agent and helper before uninstalling.

No Windows service (ADR 0022) or automatic update exists in this package. The host
can start at sign-in and can check for signed updates when you ask (ADR 0028). The native host uses a private anonymous child pipe for
graceful helper cancellation, not a public local command endpoint. Desktop/control
production gates remain disabled. The host clears development input enablement. Owner-device
install/pair/view/stop/uninstall acceptance is required before distribution.

Updates: after pairing, use Check for updates in the host window (or the agent command "update check"). Updates are signed by the Beacon Remote update key, installed only when you ask, and the previous version is kept in the "previous" folder next to the program.
