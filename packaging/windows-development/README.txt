Beacon Remote — unsigned internal Windows development host

This is a per-user development installer, not a consumer/service release.
Inspect the source and manifest. SHA256 detects damaged files; it is not a
publisher signature. Do not bypass SmartScreen, UAC or PowerShell policy.
If your policy blocks unsigned scripts, use an approved signing/testing process.

1. Extract this archive into a directory you own.
2. Run Install.ps1 through your normally approved PowerShell environment.
3. Start menu > Beacon Remote Development > Pair. Enter your Beacon Remote
   server origin and a fresh pairing code from Computers > Add a computer.
   Credentials and pairing codes are never supplied on command lines.
4. Start menu > Beacon Remote Development > Run. Keep this visible console open.
   Every attended desktop connection still needs local Allow and has local Stop.
5. Stop the host with Ctrl+C. No reboot or logon persistence is installed.
6. Revoke the computer through Beacon Remote. Run installed Uninstall.ps1 with
   -ForgetIdentity to remove this user's DPAPI-protected pairing identity too.
   Plain Uninstall preserves identity for deliberate reinstall and leaves
   unrecognized files alone. Stop the agent and helper before uninstalling.

No service, tray, restricted IPC, automatic recovery, update or rollback exists
in this package yet. Desktop/control production gates remain disabled. The
ordinary installed launcher clears development input enablement. Owner-device
install/pair/view/stop/uninstall acceptance is required before distribution.
