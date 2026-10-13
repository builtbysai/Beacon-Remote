# 0024 — Remembered support relationships

Date: 2026-10-12

## Decision

An owner can let a named Beacon Remote account request sessions on one computer until a chosen
expiry (1–90 days), for view only or view and control. This is a deliberate, optional action in the
computer's inspector. Nothing creates it automatically, and a one-time support code (ADR 0023) never
turns into one.

## Rules

- Identity is the helper's account, never a reusable code. The owner names the account by email and
  can only name an existing account other than their own.
- Every session from a relationship still needs the local Allow on the computer. A relationship
  grants the right to ask, not to skip the prompt. The computer's trusted-access policy applies only
  to the owner's own account and never to a helper.
- The helper gets no more than was granted: a view relationship cannot request control, and control
  also needs the server's control setting.
- Revoking ends the helper's live session at once, and the helper can no longer ask. Expiry does the
  same. Revoking the computer ends everything, as before.
- The owner's activity records granting and revoking; the session history records each session.
- Helpers see only the computers shared with them, on the Assist page.

## Not included

Skipping the local Allow for a helper. That would be a raise of authority and would have to be made
at the computer itself, signed with its key, as trusted access is (ADR 0021). It can be added later
without changing this model.
