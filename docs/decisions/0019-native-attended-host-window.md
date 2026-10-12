# Native attended host window

The installed per-user development host now has a native pairing/status window
and tray. It shares enrollment, DPAPI persistence and signed presence code with
the CLI. No browser password or machine private key enters shortcut arguments.
A Windows sharing lock prevents GUI/CLI presence duplication for one identity.

The interactive host owns the helper process and its anonymous stdin pipe. A
bounded first line carries the server grant; Stop or EOF only revoke authority.
Neither pipe messages nor the host window bypass server scope or local consent.
A cancellation watcher sends Stop even while the presence worker is waiting for
HTTP. The helper cancels pending consent or ends its active capture/input and
performs normal release. The host waits up to ten seconds for helper exit before
its existing job containment fallback; forced termination is not release proof.

Close and Quit visibly wait for shutdown. Minimize uses the tray only after its
icon is registered. No service, login task or reboot persistence is installed.
Session 0 service work and restricted service/helper IPC remain separate work;
the per-user pipe is not presented as that architecture. Installer signing and
actual elevated/lock held-input cleanup remain release gates.
