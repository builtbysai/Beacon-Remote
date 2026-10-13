# 0026 — Password recovery by operator-issued one-time link

Date: 2026-10-13

## Decision

There is no email service, so recovery is operator-assisted. An operator runs
`create-recovery.js <email> [--reset-mfa]` against the production database and gives the account
holder the resulting one-time link (`/#recover=<token>`). The link works once, expires after 30
minutes, and only its hash is stored.

## Rules

- Using the link sets a new password (at least 16 characters), signs out every browser session for the
  account, and kills the old password.
- Two-step sign-in stays on. A recovered password still needs the authenticator or a recovery code.
  Someone who lost the authenticator too gets `--reset-mfa`, which removes it when the link is issued.
  The operator must be sure who is asking before using that flag.
- The token is a bearer secret like an invitation: it is read from the URL fragment and removed from
  the address bar at once, and the operator must never log it.
- Unknown, used and expired links are indistinguishable. The endpoint is rate limited.

## Later

Self-service email recovery needs a mail provider and its own decision (sender domain, deliverability,
and abuse limits). It does not change this table or endpoint.
