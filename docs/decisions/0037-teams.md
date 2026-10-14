# 0037: Teams: technicians and viewers

Status: accepted, 2026-10-14

## Context

Helpers could be named one computer at a time (ADR 0024). Someone who looks after many computers, or a small team that
shares the work, needs to name a person once and have that cover every computer, including ones added later,
without adding a new kind of authority that bypasses what each computer already enforces.

## Decision

- **A team member is a person plus a role and a scope.** The owner adds an existing Beacon Remote account by email as
  a _viewer_ (view only) or a _technician_ (view and control), for _all computers_ or for one _group_ (the label
  computers already carry). They are managed in Settings, Team. Adding someone already on the team changes their role
  or group. There is a limit of 15 members per owner.
- **Membership is expressed as ordinary support relationships.** A team member's access is one relationship per
  computer in scope (view or control by role), marked as coming from the team. Everything downstream is therefore
  unchanged: the helper asks for a session from the "Shared with you" list, the computer's own consent applies (the
  local Allow, or the owner's remembered-helper setting), sessions are audited, and ending access ends live sessions
  immediately.
- **The shares are kept in step automatically.** After any change that can alter scope (member added, changed or
  removed; a computer enrolled, given a different group or revoked) the owner's team shares are reconciled: missing
  ones are created, ones that no longer match are revoked and their sessions ended. A share the owner made by hand is
  never replaced.
- **Team shares have no expiry of their own** (stored with a far-future date, shown as "from your team"), and they
  cannot be revoked one by one, because the next reconcile would put them back; the list says to change it in
  Settings, Team.
- **Roles are capped by the computer.** A technician is offered control, but a computer still decides whether control
  is allowed and whether a person must approve it, exactly as for any helper.
- **Only an owner (a signed-in, non-guest account) manages a team,** with the same origin and rate-limit rules as
  other account changes. Team changes appear in the owner's activity.

## Honest limits

- This is not an organisation: there is no shared billing, no admin who is not the owner, and no team-wide policy.
  Each owner's computers belong to that owner's account; two people cannot co-own the same list.
- The technician must already have an account, and is added by email address; there are no invitations to accept.
- Roles are only viewer and technician. Finer permissions (for example, files or recording per person) follow the
  computer's own consent choices.
