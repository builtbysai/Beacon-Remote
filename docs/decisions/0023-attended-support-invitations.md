# 0023 — Attended support with one-time invitation codes

Date: 2026-10-12

## Decision

The person at a computer can ask it for a support code, choosing view only or view and control.
The computer asks the server with a request signed by its own identity key. The server returns a
short code (8 characters from an alphabet without look-alikes, shown as `ABCD-EFGH`) and keeps only
its hash. A signed-in helper enters the code on the Assist page and receives a session on that one
computer.

## Rules

- The code lives 15 minutes, works once, and a newer code replaces an older unused one.
- A support session always needs the local Allow. The computer's trusted-access policy is about the
  owner's own account and never applies to a helper, even when it is switched on.
- The helper gets only the capability the person chose. A view code cannot become control.
- Nothing remains after the session: no machine access, no stored relationship. The helper's next
  request needs a new code. The invitation row records who redeemed it, and the owner's activity
  shows it was created and claimed.
- Invalid, expired, used and unknown codes are indistinguishable to the caller. Claims are rate
  limited, and a 40-bit code over 15 minutes at that rate is not practical to guess.
- Helpers need an account, as account creation is still by operator invitation. Guests without an
  account are out of scope for now.

## Not decided here

Remembered support relationships (a helper the owner chooses to allow again) stay unbuilt. They
need their own decision: who, which computer, view or control, whether local approval is still
required, duration, and immediate revocation, with identity tied to an account and device and never
to a reusable code.
