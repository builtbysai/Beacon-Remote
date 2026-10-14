# 0032: Public sign-up and email recovery

Status: accepted, 2026-10-13. Ships closed until mail is configured.

## Context

Accounts were created from operator invitations and recovered by operator-issued links (ADR 0026). A consumer
product needs self-service sign-up and password recovery. The server already sends operational email through
Resend for Beacon View's monitor, so a provider exists; Remote uses its own key and sender, never View's secrets.

## Decision

- **Closed by default.** Sign-up and email recovery work only when the backend has `RESEND_API_KEY` and
  `MAIL_FROM` (and `PUBLIC_SIGNUP=true` for sign-up). Without them the endpoints answer 404 and the web hides the
  links; the operator-invitation and operator-recovery paths are unchanged.
- **Confirm before use.** `POST /api/signup` stores the account with `email_verified=false` and emails a
  one-time link (`/#verify=<token>`, 24 hours). Sign-in is refused until it is used, and that is revealed only
  after the right password. Using the link signs the person in. Unconfirmed accounts are deleted after 48 hours.
- **No enumeration.** Sign-up, resend and recovery requests always answer `202`. An address that already has an
  account is mailed a notice with no link; an unknown address is mailed nothing for recovery.
- **Recovery by email** reuses the ADR 0026 one-time link and endpoint: `POST /api/account/recover/request`
  inserts a row in `account_recoveries` and mails `/#recover=<token>` (30 minutes). Two-step sign-in still
  applies after the password changes.
- **Abuse limits.** Per-connection limits on every endpoint, one email per address every two minutes (four for
  recovery), a daily cap on new accounts (`SIGNUPS_PER_DAY`, default 100) to protect the mail quota, passwords of
  at least 12 characters, and only token hashes stored.
- Mail is plain text with one link. Bodies and tokens never reach logs. If the provider fails, the request answers
  503 rather than pretending to send.

## Not done

A CAPTCHA or proof-of-work (add if the daily cap is ever reached by abuse), disposable-address blocking, and
changing the account email address.

## Mail egress (added 2026-10-14)

The production backend sits on an internal-only network, so it could not reach Resend. It now also joins a
`mail-egress` network, the same pattern the backup job uses for object storage. This is the backend's only route to
the internet; it stays read-only with all capabilities dropped, and the only place it connects out is the mail
provider's API. Sending uses the shared `auth.builtbysai.com` domain with a Remote-only, sending-only API key.
