# Deliver attended requests without fixed polling delay

Date: 2026-10-10. Milestone 4.

The owner confirmed desktop viewing and local Stop on an Android browser using
T-Mobile mobile data, but reported slow arrival of the Windows consent dialog.
The native agent slept for 15 seconds between signed heartbeats; requests created
during sleep could wait nearly that long before any helper started. The helper
also authenticates its signaling socket before showing consent, which remains
required. No measured dialog latency is claimed yet.

Use the existing signed heartbeat with an optional `wait=1` query to hold an idle
response for at most 15 seconds. Register a machine-specific waiter before reading
pending state, and wake it only after a view-request transaction commits. Release
the heartbeat transaction/client before waiting; no PostgreSQL connection remains
reserved during an idle poll. Re-read pending authorization/state after waking.
There is one waiter per authenticated machine; replacement, disconnect, timeout,
revocation and shutdown settle it and remove its timer/listeners. An in-flight
heartbeat reaching delivery after shutdown begins does not open another wait.

The native agent supplies the last handled request UUID as a timing cursor, so an
open consent dialog cannot cause immediate duplicate-grant polling. This query
changes scheduling only; it is neither a grant nor an authentication claim.
The unchanged canonical Ed25519 heartbeat, nonce/replay and revocation checks
precede every wait. Owner/Origin checks and the existing one-session constraint
still precede request creation. No new service, dependency, schema or polling
storm is needed. This relies on the enforced single backend per database.

Updated responses select immediate re-polling after a held response. Older or
media-disabled servers fall back to the existing 15-second cadence; new servers
continue accepting old clients without holding their responses. The long-poll
client timeout is 25 seconds; connection failures retain existing backoff.
Only requests actually marked handled by the helper manager advance the cursor.
If the previous helper is still closing, retry the pending new request after one
second instead of losing it or spinning through immediate duplicate responses.
Helper job binding, authenticated WebSocket setup, local approval, visible Stop,
two-minute grant deadline and monotonic capture lease are unchanged.

Real HTTP/PostgreSQL validation uses a single-connection pool to prove waiting
does not consume it. It checks idle waiting, fresh-request wakeup, cross-machine
isolation, replay rejection, suppression of a handled grant, delivery of the next
distinct request, client abort and revocation. Existing consent/audit and socket
regressions remain required. Actual improved Windows consent timing still needs
the owner's acceptance with matching CI binaries and backend.
