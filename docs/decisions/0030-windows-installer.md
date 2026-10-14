# 0030: Per-user double-click installer

Status: accepted, 2026-10-13

## Context

The host was installed with a PowerShell package (`Install.ps1`). That is not a consumer install. The host already
runs per user with no service or elevation (ADR 0022, 0029): start at sign-in is an HKCU Run value the host window
toggles, updates replace the programs in the folder the host runs from (ADR 0028), and credentials live under
`%LOCALAPPDATA%\BeaconRemote`.

## Decision

`apps/windows-setup` builds `beacon-remote-setup.exe`, one executable that embeds the three programs and the
package manifest.

- **Install** (double-click): per user, no administrator rights, to `%LOCALAPPDATA%\Programs\Beacon Remote`. Adds
  a Start menu shortcut, an Apps and features entry and start at sign-in (on for a fresh install, preserved on an
  upgrade), copies itself in as `Uninstall Beacon Remote.exe`, then opens the host so the person can pair.
- **Uninstall**: stops processes started from the install folder, removes everything it added, deletes this
  computer's saved sign-in, and leaves files it did not create. The computer stays in the account until removed on
  the website; the uninstall dialog says so.
- **Updates** stay on the signed zip feed. The installer lays down the same files and `manifest.json` the updater
  reads, so an installed host updates and rolls back unchanged.
- An embedded `asInvoker` manifest stops Windows' installer-detection heuristic from asking for elevation because
  the file is named "setup".
- `--silent` skips dialogs and does not launch the host. `BEACON_SETUP_SANDBOX=1` redirects registry writes to a
  test key; `scripts/Test-Installer.ps1` uses it with a temporary profile to check install, reinstall and uninstall.

## Not done

Public Authenticode signing (ADR 0035 signs with a free self-signed certificate that devices trust on purpose), a
branded graphical wizard, and a machine-wide install. The first needs the owner's certificate; the others are not
needed until there is a reason for administrator-level installs.
