# 0017 — Package the working attended host before service persistence

Date: 2026-10-12

The owner authorized an unsigned working development installer while service,
tray, restricted IPC and recovery are still being developed. The existing
interactive agent already pairs with one-use enrollment, protects its identity
with current-user DPAPI and dispatches the native consent/helper.

Package that working boundary as an explicit per-user PowerShell installer with
Pair/Run/Uninstall shortcuts. No elevation, OS policy changes, startup registration,
automatic download, permanent unattended authority or helper-in-Session-0 is
introduced. The host remains a visible console; this is stated in the package.

Build the exact committed native sources and include payload SHA256 plus the
native commit. Hashes detect damage, not publisher identity. Real signing and
consumer distribution stay gated. The wrapper removes development control
enablement; input demonstrations use the separate isolated fixture.

Uninstall refuses running endpoint processes and removes only known package
files/owned shortcuts. Preserve identity by default; explicit identity removal
uses the existing agent forget operation after server revocation. Do not kill
processes or delete unknown files to make installation/removal succeed.
