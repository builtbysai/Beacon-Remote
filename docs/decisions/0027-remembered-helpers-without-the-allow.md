# 0027 — Remembered helpers without the local Allow

Date: 2026-10-13

## Decision

A remembered support relationship (ADR 0024) normally still needs the local Allow for each session.
The person at the computer can switch that off for people they remembered, at one of two levels:
view without asking, or view and control without asking. It is raised only on the computer, signed with
the computer's key (`/api/agent/helpers`), exactly as trusted access is (ADR 0021), and the host window
asks for confirmation before raising it. The owner can lower it from the web; it can never be raised there.

## Rules

- It applies only to sessions started from a remembered relationship. A one-time support code (ADR 0023)
  always needs the local Allow, and the computer's trusted access still applies only to the owner's account.
- Both sides must agree: the server records the level, and the agent's own local setting must also allow it.
  The lower of the two wins, and the host helper skips the prompt only when both do.
- A helper session records the policy version it relied on and ends within the renewal lease when the level
  is lowered, when the relationship is removed or expires, or when the computer is revoked.
- Control without asking needs the control level; the view level never covers control.
- The sharing indicator and the local Stop are unchanged and always visible.

## Why a signed request from the computer

The owner's web account can already create relationships. Making the computer the only place that can waive
the Allow keeps a stolen web login from turning a helper entry into silent control of a computer that never
agreed to it.
