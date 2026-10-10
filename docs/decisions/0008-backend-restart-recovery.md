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

Startup now enforces this prerequisite with a database-scoped PostgreSQL session
advisory lock, acquired before application creation or recovery. A second process
fails without touching live grants, even when it uses a different HTTP port.
The lock uses a dedicated connection kept outside the request pool; closing the
backend releases it only after application/pool shutdown. Startup failures also
close it. A detected error/end on that connection immediately exits the process
with a nonzero status, closing signaling sockets without waiting for database
cleanup. The replacement recovers persisted rows; existing native leases remain
the independent bound during an undetected network outage. This is not distributed
fencing or support for overlapping replicas.

Use a direct PostgreSQL connection or a session-preserving proxy, never transaction
pooling. Session lock lifetime follows the database connection as documented by
[PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).
The owner connection consumes one additional database connection beyond the
request pool's maximum of eight. No schema migration or elevated runtime role is
needed.

Real PostgreSQL validation uses an isolated schema. It exercises audit failure
rollback, persisted interrupted grants, rejected old WebSocket authorization,
and successful creation of a fresh pending request. These checks do not replace
real Windows capture/Stop acceptance across a backend interruption.

A real-process regression starts the actual backend entrypoint against an isolated
schema, rejects a second backend on another port without changing an active grant
or its audit history, terminates only the fixture owner's database session, checks
nonzero backend exit, then verifies replacement startup recovery and its audit.

The signaling suite also terminates each peer in turn using actual WebSockets,
verifying closure of the survivor, persisted ended status and rejection of both
old peer authorizations. Following the native helper lifetime fix, an actual
synthetic relay session ended after forced fixture-agent termination; PostgreSQL
stored ended and its old browser WebSocket returned 403. Real desktop interruption
acceptance remains pending.
