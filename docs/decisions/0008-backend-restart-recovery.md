# End interrupted view grants before backend startup

Date: 2026-10-10. Milestone 4.

Signaling sockets and consent leases are process-local. A crash previously left
persisted requested/connecting/active rows occupying the unique live-machine
slot until their deadline. The new process could not recover active sockets or
reuse consumed machine tokens, so a fresh request reported the computer as busy.

The single backend startup now atomically ends these rows and records a backend
interruption audit event before listening. A failed recovery/audit transaction
fails startup. Denied/ended history stays unchanged; recovery is idempotent.
Reconnect starts a new request and requires fresh local approval. Native
monotonic lease expiry independently stops capture during a backend outage.

Run one backend per Remote database and stop its predecessor before replacement.
This is consistent with the existing single-instance deployment. It is not a
multi-instance signaling design or a claim of seamless session recovery.

Real PostgreSQL validation uses an isolated schema. It exercises audit failure
rollback, persisted interrupted grants, rejected old WebSocket authorization,
and successful creation of a fresh pending request. These checks do not replace
real Windows capture/Stop acceptance across a backend interruption.
