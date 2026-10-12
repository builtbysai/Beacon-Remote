# Access policy and session lifecycle

Status: accepted, implementation in progress (2026-10-12).

## Why

Early milestones used a fixed two-minute view session, a ten-second reconnect window, a viewing-only resume, and a
local Allow for every connection. Those bounded the first tests. They are not how someone uses their own computer.
This record separates what is only a test limit from what protects the owner, and defines the model that replaces
the limits without weakening the protections.

## What each existing limit is

| Limit | Kind | Decision |
| --- | --- | --- |
| Session `expires_at` = now + 120 s | Test restriction | Becomes an absolute cap, default 12 h (`SESSION_MAX_HOURS`), never shorter than the sign-in it rides on. |
| Approval window for a pending request, 120 s | Real | Keep: a request nobody answers must not stay open. Applies only to a local Allow. |
| 1 s renewal, 3 s lease, checked against the database each time | Real | Keep. This is what makes revocation, sign-out and a revoked computer take effect within seconds, and it is why the hard cap can be long. |
| Relay (TURN) credentials end with the session | Test restriction | Relay credentials live 30 minutes and are re-issued while the session is valid. |
| Reconnect window 10 s, view only | Test restriction | 120 s attended and 300 s trusted, for control too. Capture and input stay stopped while no viewer is attached. |
| Local Allow on every request | Attended mode only | Trusted personal access skips it; see below. |
| One live session per computer, one controller | Real | Keep. |
| Ended, denied, revoked or expired sessions cannot be revived | Real | Keep, for every mode. |
| Development flags for unlimited sessions and control | Test scaffolding | Replaced by the model here. Production control and media stay behind an explicit operator switch until accepted. |

## Lifecycles that no longer expire together

1. **Computer identity**: an Ed25519 key kept under DPAPI, enrolled once. Survives restart. Ends only by revocation.
2. **Access policy** (`machine_access`): `attended` (default) or `trusted`, plus whether control is allowed. It can only be
   raised by the computer itself, with a signed request made from its own host window, so a stolen sign-in cannot turn
   a computer into an unattended one. The web app can always lower it, and doing so ends the sessions it allowed.
3. **Sign-in**: the browser session. Ending it ends the sessions that browser started, within the lease.
4. **Session** (`view_sessions`): capability, approval (`local` or `policy`), absolute cap. Authority is re-proven every
   second; there is no per-session timer to run out in the middle of use.
5. **Transport**: a WebRTC peer, replaceable within the session. Up to 16 generations, with backed-off retries.
6. **Relay credentials**: short, re-issued, never the thing that ends a session.

## Approval

- `local`: the person at the computer chooses Allow (the existing consent window). A request left unanswered ends after
  120 s. Once allowed, reconnects within the reconnect window do not ask again.
- `policy`: only when the computer's policy is `trusted` and (for control) allows control. The server records
  `approval = policy` and the policy version. The native helper accepts that only when the computer's own local
  setting also says trusted access is on, so the server alone cannot create unattended access. Sharing stays visible:
  the capture border and the Stop window show who is connected, and Stop and sign-out end the session at once.

Windows lock, UAC and the secure desktop are unchanged: capture and input stop there, resume after unlock within the
reconnect window, and nothing bypasses them.

## Not decided here

Support invitations (attended help from someone without a trusted relationship) and remembered support relationships
get their own records when built. They use the same session model: a different way to reach `approval`, not a different
lifecycle.
