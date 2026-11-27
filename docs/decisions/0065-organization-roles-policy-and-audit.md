# 0065: Organization roles, policy, scheduled access and audit

Status: proposed November 27, 2026. Design only: nothing here is built, no migration is written, and it widens no
authority. It extends the team model of [0037](0037-teams.md) (built on the support relationships of
[0024](0024-remembered-support-relationships.md)) and the audit actor of migration 017. It is the "organization roles, policy, scheduled access and audit"
item of roadmap M8.

## What exists today

One owner account can add team members as a `viewer` (view only) or a `technician` (view and control), for all of their
computers or one group of them. Each membership is kept as an ordinary support relationship, so consent, revocation and
audit behave as for a single shared computer. Each computer still asks the person at it, by its own settings. Activity is
recorded in `audit_events` with the member as the actor. There is no other role, no time limit on a membership, no rule a
group can carry, and no way for anyone but the owner to read the activity.

## The rule everything else must keep

**Organization policy can only narrow what a computer allows, never widen it.** The person at a computer, and that
computer's own settings (attended or unattended, control, files, clipboard, drive, print), stay the last word. Leases stay
short, revocation stays immediate, and no media or input ever passes through the server. A policy that would grant
something the computer did not is a defect, and a test must say so (see below).

## Decisions proposed

1. **Stay inside the owner's team; do not add a separate organization identity yet.** An "organization" is an owner's team.
   Several owners, SSO and SCIM are out of scope here (see "Not decided").
2. **Two more roles, neither of which can connect.**
   - `manager`: adds and removes members and edits group policy. Cannot open a session or read recordings of anything.
   - `auditor`: reads and exports the activity log. Cannot change anything.
     `viewer` and `technician` keep their meaning. A person may hold one role per team. The owner is always all of them.
3. **Group policy, enforced by the server when it issues or renews a lease and again at every renewal.** A group may set:
   the highest capability a member may ask for (`view` or `control`), the longest session, whether files, clipboard, drive
   and print may be requested live, and whether a member must always ask the person at the computer even where the computer
   would allow them in unattended. Each setting is a ceiling; an absent setting means "whatever the computer allows".
4. **Scheduled access is a window on a membership or a group, not a new kind of access.** Hours of the week and a time zone,
   plus an optional start and end date. Outside the window a request is refused with the reason; a session in progress ends
   at the window's end because its lease will not renew. Daylight-saving changes use the zone's own rules; a window that
   crosses midnight belongs to the day it began.
5. **The audit log is append-only and content-free.** It records who (actor and role), what (connect, stop, a permission
   asked, approved or denied, a member added or removed, a policy changed), which computer and when. It never records pixels,
   keystrokes, clipboard text, file names, typed text, tree contents or tokens (the secret-logging guard in the test suite
   already covers the code paths). The owner and an `auditor` can read and export it (JSON and CSV); retention is a
   per-team number of days with a floor, and expiry deletes rows rather than editing them.
6. **Changes to roles and policy are audited the same way and take effect at the next lease decision**, which is within
   minutes because leases are short. Removing a member or narrowing a policy also ends their current sessions.

## What this does not change

- Local consent, the single-controller lease, the visible capture indicator and Stop.
- That the computer, not the server, decides whether unattended access is on.
- Server storage of media (still none) and the closed list of agent tools.

## Not decided here

- Several owners for one team, separation of duties between owners, SSO, SCIM and billing.
- Whether a `manager` may delete the audit log (proposed: nobody can; only retention expiry removes rows).
- Whether policy should also be able to require a second person's approval for control of a computer.

## Checks that would settle it

- A migration that is additive and idempotent (new columns and tables only), with a down-path stated.
- Tests that a policy can never raise a capability above what the computer allows, and that every role without the
  right is refused at the lease, not just hidden in the page.
- Tests for window edges: start and end instants, a window across midnight, the two daylight-saving changes of a year, and a
  session crossing the end of its window.
- A test that every lease issue, renewal, refusal and stop, and every role and policy change, writes exactly one audit event
  with an actor, and that no event carries content.
- A review of export: an `auditor` cannot read another team's log, and a removed member's past events stay readable to the
  owner.
