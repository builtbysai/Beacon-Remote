# 0043: Restarting a computer remotely

Status: accepted, 2026-10-14

## Context

Support often ends with "restart it". A restart ends everything on the computer, so it is a stronger act than viewing and has to be
at least as hard to do by accident or by someone else as control is.

## Decision

- **Who and when.** Only the owner, only for a computer that is online, only when that computer is in the owner's trusted
  mode with control allowed (ADR 0021). Attended computers, view-only trust, helpers and temporary support computers are
  refused. The computer checks its own local setting again before acting, so a stale server value cannot restart it.
- **How.** `POST /api/machines/:id/restart` records one request (valid two minutes, delivered once) that the computer's own agent
  receives in its signed heartbeat response. The agent runs Windows' own `shutdown /r /t 30` with a message naming the
  reason, so Windows shows a countdown and anyone at the computer can cancel it with `shutdown /a`. Applications are not
  forced closed, so unsaved work can still stop a restart.
- **After the restart.** Beacon Remote runs in a signed-in session (ADR 0022), so the computer is reachable again once Windows
  has started, the owner (or automatic sign-in) has signed in, and the host starts at sign-in. A session is not resumed
  automatically: the viewer connects again, which under the owner's trusted policy needs no prompt.
- Recorded in the owner's activity.

## Not done

Restart into Safe Mode, restarting a computer at the sign-in screen, and resuming the viewer automatically when the computer returns.
