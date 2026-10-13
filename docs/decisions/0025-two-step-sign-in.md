# 0025 — Two-step sign-in

Date: 2026-10-12

## Decision

An account can turn on two-step sign-in with any authenticator app (TOTP, RFC 6238: SHA-1, six
digits, 30 seconds). Once on, a correct password starts no session. The browser receives a
five-minute signed challenge and must then present a six-digit code or a one-time recovery code.

## Why now

With trusted access (ADR 0021), a signed-in session can reach a computer with no prompt, so an
account takeover is a remote-control takeover. A second step is the control that matters most there.

## Rules

- The secret is stored encrypted (AES-256-GCM) under a key derived from `SESSION_SECRET`, so a copy
  of the database alone does not reveal it. Without `SESSION_SECRET` the feature is unavailable.
- Each time step works once (a replayed code is refused). A window of one step either side allows for
  clock drift.
- Ten recovery codes are shown once at setup and stored hashed. Each works once.
- Five wrong codes lock the second step for 15 minutes, even for a correct code. Sign-in routes are
  also rate limited per address.
- Turning it on signs out every other browser. Turning it off needs the password and a code.
- Setup uses a manual key; no QR library is added.

## Not included

Password recovery. Losing both the authenticator and the recovery codes needs an operator to remove
the second step, as account creation is still by operator invitation.
