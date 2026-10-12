# Local development sessions until stopped

The owner requested removal of the demonstration timeout after its two-minute
cutoff interrupted real input acceptance. The isolated loopback fixture now runs
until explicitly stopped. Approved sessions have no fixed maximum duration.

`DEV_SESSION_UNLIMITED=true` requires a nonproduction loopback origin, enabled
session authorization and no TURN. A nullable database expiry is represented by
`expiresAtMillis: 0` in authenticated grants. Ordinary configurations reject that
authority. The native helper additionally requires
`REMOTE_DEV_SESSION_UNLIMITED=true` and a loopback server.

Pending approval remains bounded to two minutes. Accepted authority still needs
fresh, nonce-bound server renewal every second with a three-second lease. Input
renews only the same live controller and never revives an expired lease. Local
Stop, lock, disconnect, revoke and backend shutdown terminate capture/control.
This changes local acceptance duration, not production release policy.
