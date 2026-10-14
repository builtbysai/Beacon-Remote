# 0039: Disconnect, revoke, and uninstall and remove

Status: accepted, 2026-10-14

## Context

An owner needs to take access away from a computer in three different ways, with different consequences, and one of
them (removing the software) has to work even when the computer is off at the time.

## Decision

Three separate actions on a computer, each with its own confirmation text in the computer's panel:

- **Disconnect now** (`POST /api/machines/:id/disconnect`) ends every live session and leaves the computer enrolled and
  available for future authorised access. Recorded in activity.
- **Revoke access** (existing `POST /api/machines/:id/revoke`) removes the computer's authority and now also ends its
  live sessions. Beacon Remote stays installed on it until removed.
- **Uninstall and remove** (`POST /api/machines/:id/uninstall`) revokes the computer immediately and keeps one
  instruction, valid for 30 days. It is delivered only to the computer's own signed heartbeat: a revoked computer that is
  pending removal gets `uninstall: true` and nothing else (no sessions, no access policy). The computer confirms with a
  request signed by its own key (`/api/agent/uninstall-done`) before it deletes anything, and then the server records it
  as removed. Until then the computer is revoked, so nothing can connect to it, but the instruction cannot be lost: the
  server's authority is revoked first and the removal does not depend on any connection staying valid.

On the computer, an installed Beacon Remote runs its own uninstaller (`--uninstall --removed-by-owner`), which stops
the host, deletes Beacon-owned files, the shortcut, the Apps and features entry, the start-at-sign-in value and the saved
sign-in, and leaves everything else. It does not ask, and it says on screen that the owner removed it. A copy that was not
installed by the installer only deletes its saved sign-in. Remote removal never offers or performs certificate trust
changes (those need an administrator on that computer).

## Limits

- A computer that is off or unreachable cannot be uninstalled by anyone. Revoking it server-side is immediate; the
  instruction waits up to 30 days for it to reconnect. A computer that already saw its revocation (a 401) stopped asking
  and will not receive the instruction; use Uninstall rather than Revoke first when removal is the goal.
- Temporary support computers (ADR 0038) are ended with End support and are not uninstallable this way.
- A persistent computer is never uninstalled because a session ended.
