# Independent sessions: native first, gateway later

P2-5 asks whether independent per-user desktops, multiple sessions and application
publishing should be built natively or delegated to a licensed RDP/RDS gateway.
This decision picks the order and the boundary. It does not build either path.

## Decision

Build the native path first, in small steps, and keep a gateway as an optional
interoperability target. Reasons:

- Beacon already owns consent, revocation, single-controller leases and visible
  capture on each computer. A gateway would hand the session to a Windows Terminal
  Services stack the owner has not configured here, and its consent and indicator
  model would not match Beacon's.
- Per-user desktops need Windows session management (`WTSEnumerateSessions`,
  `CreateProcessAsUser` in the right session, Session 0 isolation). Those rules
  are already the boundary in `docs/security.md`, so the native work extends them
  instead of bypassing them.
- Licensing is a real cost: RDS client access licences and a Windows Server host
  are needed for multi-user RDP. Beacon should not depend on them for the basic
  product.

## What the native path must do first

1. Enumerate sessions on one computer and show each to the owner before any
   attach. A session the owner cannot see is never attached.
2. Attach one viewer to one existing console session, as today. No second user
   gets a desktop until the owner approves that user for that session.
3. Refuse to create a new interactive session unless the owner has configured
   that computer for it (this touches boot, sign-in and restart, which remain
   gated by `docs/deployment.md` and ADR 0048).
4. Disconnect and logoff are separate actions. Disconnect keeps the session
   running; logoff ends it and is always an explicit owner choice.

## What is deferred, not dropped

- Application publishing (RemoteApp-style single windows) waits until the
  per-session work is verified on a device.
- A gateway adapter is evaluated only when a customer needs RDP clients to reach
  Beacon-managed computers. It would sit beside the native path, never replace
  it.

## Not decided here

Whether simultaneous independent desktops on one Windows client are supported
depends on device acceptance on a multi-session Windows edition. Until that is
tested, the product does not claim multiple simultaneous users.
