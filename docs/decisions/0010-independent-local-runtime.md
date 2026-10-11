# Independent local runtime ownership

Date: 2026-10-11. Active milestone 4.

View and Remote are developed simultaneously on one Windows computer. Shared
Node installation, Docker daemon and Oracle edge/relay services must not imply
shared process ownership or configuration. Existing View work is live and must
remain intact. Remote reserves API 3010, viewer 5174 and local PostgreSQL 5433.

Vite binds its port strictly instead of falling through to another port.
A small Node supervisor starts the actual backend and viewer with fixed local
database/origin and media disabled, logs/state in ignored `.remote-dev/`.
An exclusive owner file identifies one run. Stop writes a run-specific marker;
only the supervisor's original child handles are stopped. Disk PIDs are diagnostic
only, never kill targets. Occupied ports and stale/ambiguous state fail safely.
Docker PostgreSQL remains up, and View process state is never consulted for stop.

This is local convenience, not a Windows endpoint service or installer. A hard
supervisor crash can leave local children/stale state and needs inspected manual
recovery; we do not trade safe ownership for automatic broad process cleanup.
No shared Oracle changes are part of this decision. Current View worktrees,
secrets/recovery identities, databases and rollback material remain independent.

Validation used actual PostgreSQL/backend/Vite startup, HTTP readiness and owned
stop. A real unrelated TCP listener survived Remote's refused startup and stop.
Full local backend/web checks used the separate Remote test database. No new
desktop capture, human consent test or production release is implied.
