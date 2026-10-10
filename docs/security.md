# Security boundaries

Machine private keys never leave the endpoint. User-scoped DPAPI protects the
development agent's serialized identity at rest; this is not proof against a
compromised Windows user or administrator. The later service uses a separate
credential context and restricted filesystem ACLs, not shared plaintext files.

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
registration, recovery, MFA, and federation are absent. Operator-issued one-use
account invitations permit owner-chosen passwords for the private alpha; see
[the invitation decision](decisions/0004-operator-account-invitations.md). Do not open this release
for general consumer use until those account lifecycle controls are reviewed.

The media branch issues short-lived `desktop:view` grants, requires local desktop
consent and a visible Stop sharing control, checks account/machine revocation,
and enforces one live session plus monotonic renewal expiry. Capture starts only
after peer connection and a live lease. Viewing grants confer no input access.
`desktop:control` remains a separate later authorization. Future clipboard/file-transfer/admin scopes
remain unauthorized and unimplemented. The core interfaces themselves do not
authenticate callers; the eventual adapter must validate signed server grants
and local consent before creating a lease.

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
private keys, screen pixels, and input contents. Retention and account deletion
still need implementation before release. Do not claim end-to-end encryption:
WebRTC transport encryption alone does not authenticate peers against a malicious
signaling service. Installer signing and an independently authenticated update
manifest are release gates, not cosmetic checks.
