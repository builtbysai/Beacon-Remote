# Security boundaries

See the [October 12 public-source security review](security-review-2026-10-12.md)
for inspected history, CI hardening, publication settings and remaining gates.
Public source visibility does not authorize a general-consumer or media release.

Machine private keys never leave the endpoint. User-scoped DPAPI protects the
development agent's serialized identity at rest; this is not proof against a
compromised Windows user or administrator. The boot service uses a separate
presence-only key, machine-scoped DPAPI and restricted filesystem ACLs, not
shared plaintext files.

Enrollment codes are sensitive bearer invitations, delivered only to an
authenticated owner with an exact same-origin check. They expire after five
minutes and are claimed atomically. Signed heartbeats bind version, machine ID,
timestamp, and nonce; the server rejects forgery, stale timestamps and replay.
Revocation prevents presence immediately on the server and terminates the agent
when it next receives rejection. No desktop session is created by enrollment.

Browser session tokens are random, stored hashed, eight-hour, HTTP-only,
SameSite=Strict, Secure in production. Login and enrollment are rate-limited;
write routes require an exact Origin. Account IDs constrain every inventory and
revoke query. Camera credentials and sessions grant no computer access. Public
registration, verified email, recovery and two-step sign-in are implemented;
federation is not. Operator-issued one-use account invitations also work; see
[the invitation decision](decisions/0004-operator-account-invitations.md). Do not open this release
for general consumer use until those account lifecycle controls are reviewed.

The service issues leased `desktop:view` or `desktop:control` grants, requires
local approval or a locally enabled standing owner/helper policy and a visible
Stop sharing control, checks account/machine revocation,
and enforces one live session plus monotonic renewal expiry. Capture starts only
after peer connection and a live lease. Viewing grants confer no input access.
`desktop:control` is a separate capability, enabled by an operator switch in the
hosted alpha. Viewing alone grants no input authority. File reception and
recording have separate local permission; attended helpers cannot inherit an
owner's unattended setting. The native adapter validates the server grant and
local permission before creating a lease.

A matching attended helper may preserve an ongoing approval through a short
browser reload. Capture stops while the viewer is absent, and recovery requires
the exact original browser login, live original helper and unchanged deadline.
Stop, lock, expiry, revocation and restart still end authorization. See
[the active reload decision](decisions/0015-active-viewer-reload-recovery.md).

Local consent acceptance or denial and its audit record commit in one PostgreSQL
statement. A failed audit insert rolls back the state transition; signaling only
acknowledges consent after that statement succeeds. An invalid or repeated
transition does not create a consent audit event. Audit acceptance records local
permission, not proof that video was decoded or viewed.

Threats to test include account isolation, pairing races, credential theft,
heartbeat replay, stale presence, forged signaling, controller collision,
session replay, held modifiers after disconnect, malicious IPC clients, UAC
boundaries, compromised updates, and signaling/relay denial of service.
Logs must exclude request bodies, cookies, pairing codes, signatures, passwords,
private keys, screen pixels, and input contents. Account deletion and retention
are implemented; broader release still needs the roadmap's acceptance. Do not claim end-to-end encryption:
WebRTC transport encryption alone does not authenticate peers against a malicious
signaling service. Installer signing and an independently authenticated update
manifest are release gates, not cosmetic checks.

Unattended work is described in [ADR 0047](decisions/0047-unattended-owner-access.md)
and the [acceptance guide](unattended-access.md). The boot service uses a distinct
presence-only credential and no IPC, launch or desktop authority. Machine-scope
DPAPI is paired with a protected SYSTEM/Administrators ACL, never used as a
substitute for an ACL. Android unattended access requires a local standing
setting, an owner policy grant, enabled accessibility and notifications, and an
unlocked screen. The screenshot API respects protected content. A missing
permission or stale lease cannot be replaced by server approval alone.

The October 30 scope adds Windows sign-in-screen control as a required future
capability, not a permission granted to the current service. See
[ADR 0048](decisions/0048-boot-login-and-restart.md): separate administrator-enabled
machine authority, owner-only scoped leases and an interactive secure-desktop
worker are required. The existing presence key retains no desktop authority.
Restart recovery requests new authorization and rejects a grant whose policy
no longer permits unattended access. Signed host process markers detect fast
host restarts; they convey no additional permission.
