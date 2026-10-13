# Recover a browser reload within an active attended approval

## Context

The owner tested browser refresh on October 12. It disconnected the desktop
session, as the previous lifecycle implementation intended, but the owner
explicitly requested that refreshing preserve an active session. This is a
milestone 4 transport requirement, distinct from remembered personal-device
access after Windows lock/reboot in ADR 0014.

## Decision

A matching helper advertises resumable transport only after local consent and
creation of the visible Stop window. When that viewer disconnects, the backend
retains the existing approval for at most ten seconds, bounded by its original
two-minute deadline. The native helper destroys its old peer/capture worker and
cached frames, keeps the same visible Stop window and monotonic deadline, and
waits for a replacement viewer. No local Allow action is automated or repeated.
The browser stores only the session identifier and display name in tab-local
session storage; it does not store a machine token, consent bearer or TURN
credential. On reload it asks the backend to resume the ongoing view.

Recovery requires the exact original authenticated browser login, same origin,
active session, unrevoked machine, live original helper and unexpired recovery
window. Another login on the same account cannot replace that controller. Only
one viewer socket may exist. The backend continues checking the original login
while the viewer is absent; logout/session revocation stops recovery. A browser
identifier alone conveys no access. Transport generations discard delayed SDP/
ICE packets from older connections. Existing message budgets remain bounded.

The helper uses one renewal challenge sequence and monotonic epoch across media
cycles. Recovery does not reset challenge age or extend consent. While paused,
capture is destroyed; newly connected media requires a valid renewal and the
original local session flag. Local Stop denies capture and queued media across
all cycles. Lock, secure desktop, grant expiry, backend/helper restart, failed
authorization or a missed recovery window ends the session. An ended grant
cannot resume; a fresh attended request still needs manual Allow.

## Compatibility and limits

Helpers that do not advertise recovery retain immediate termination on viewer
disconnect. A matching backend/web/helper deployment is required to test the
new behavior. Page unload cannot reliably distinguish refresh from closing a
tab: closing a resumable tab leaves the Stop window for the same short recovery
window, with capture stopped. The explicit browser/Windows Stop controls remain
immediate. No automatic retry after an ended session, lock or reboot is added.
Mobile reloads that exceed the recovery window require a fresh request.

The first matching real-device test returned video after refresh, but the owner
reported a long delay and a later connection failure. That is partial recovery
evidence, not a reliability pass. Inspection found renewal suspended during peer
setup/cleanup and a disconnect flag that stayed set after peer recovery.

Renewal now runs in a separate bounded signaling task for the original approval.
It owns the original challenge sequence/epoch and validates replies before
updating the shared lease; media setup and cleanup cannot postpone that task.
Missing, expired or invalid authorization stops the original session. A viewer
detach updates the shared transport generation immediately, denying old media
even while the media loop is busy. Peer and worker cleanup run concurrently,
but both finish before a replacement cycle. Safe setup/cleanup timings contain
no SDP, candidates, tokens or pixels. The browser and helper allow at most three
seconds for the helper to receive a viewer detach. The browser allows two seconds
for the same peer to recover a transient disconnected state; connected clears
that timer. A browser may now replace a failed peer automatically, at most
twice within the original approval. It closes its old socket, asks the existing
resume endpoint to validate the original login and grant, and opens a replacement
transport. A failed native peer sends a generation-bound retry notification;
only the active resumable machine may send it. The native helper pauses capture and allows up to three seconds for
that detach to arrive before ending the old cycle. The same visible Stop window
and original deadline survive a valid replacement. Stop, logout, navigation,
lock, expiry or an unsuccessful authorization response prevent the replacement;
the resume request itself has a two-second network budget. Candidate pooling
prepares a browser relay candidate while Windows consent is pending, without
starting capture. ICE state/error-code and first-packet timings exclude network
addresses, usernames and credentials. No ended approval is revived.

Real PostgreSQL/socket regressions check isolation, one viewer, unchanged expiry,
stale transport packets, Stop, logout, machine revoke, expiry and recovery timeout.
Native loopback signaling checks original lease/deadline/local Stop and generation
guards without opening a consent dialog or capturing. These checks do not prove
actual desktop reload playback, Windows capture-border cleanup, relay routing or
performance; those remain guarded Windows/Android acceptance gates.
