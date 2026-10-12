# Attended capture requires the local input desktop

The attended Windows helper must stop sharing when its desktop no longer
receives local input. A retained WGC frame does not establish that the desktop
is still available: Windows can lock or enter a secure desktop while the
application still owns a cached snapshot.

The helper queries `GetUserObjectInformationW` with `UOI_IO` on its borrowed
`GetThreadDesktop` handle. Microsoft documents this flag as whether that desktop
receives user input. A false result, missing handle, or failed query denies
consent and capture startup. Frame callbacks and snapshot access check the same
condition, clear the retained snapshot, and mark the shared active flag false.
The capture worker and signaling loop then end the session through their
existing shutdown path. Unlocking does not reactivate that flag; a fresh request
and local consent are required.

No desktop switch, secure-desktop access right, elevation, or session reassignment
is used by the product. The borrowed thread-desktop handle is never closed.
The check runs with normal frame/snapshot processing; it is not an OS event
subscription and does not claim zero-latency shutdown. It also does not replace
the lease, grant deadline, local Stop, or agent-owned kill-on-close job.

The Windows regression creates a hidden temporary desktop on a fresh thread,
without switching the visible desktop. It verifies denial of consent and capture
startup, denial of a seeded cached snapshot, active-flag termination, and cache
clearing. It restores the test thread's original desktop and closes the owned
test handle. No real screen is captured and no human consent is automated.

Real lock/unlock, UAC secure-desktop, display-loss, and session-disconnection
acceptance remain separate hardware gates. Record that actual video ends and
the old request cannot resume, then verify a new request requires fresh consent.

References:

- [GetUserObjectInformationW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getuserobjectinformationw)
- [GetThreadDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getthreaddesktop)
- [CloseDesktop](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-closedesktop)
