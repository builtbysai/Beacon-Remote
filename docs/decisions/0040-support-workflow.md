# 0040: Support workflow: chat, notes and handoff

Status: accepted, 2026-10-14

## Context

Temporary support (ADR 0038) lets a technician reach someone with one link. The person and the technician also need to talk
without a second tool, the technician needs somewhere to write down what they did, and a session sometimes has to pass to
a colleague without the person starting over.

## Decision

- **Chat belongs to the temporary computer.** The technician reads and writes through their signed-in session
  (`/api/machines/:id/chat`, only for a temporary computer they own). The person's support program uses one signed request
  (`/api/agent/chat`) that sends an optional message and fetches anything new, signed with the program's own key over the
  message hash, with a fresh nonce so it cannot be replayed. Messages are plain text up to 1,000 characters, stored with
  the computer and removed with it (30 days after support ends, ADR 0038's retention). The person sees the conversation in
  the support window and the window flashes for a new message; nothing is shown until they open or look at it.
- **Notes are private to the technician** (`/api/support-links/:id/notes`, 4,000 characters) and shown in their history.
- **Handoff** (`/api/support-links/:id/handoff`) passes a live session to another of the owner's team members who is a
  technician (ADR 0037). The computer and the link change owner in one transaction; any session in progress ends, so one
  technician controls the computer at a time; the person sees "Your technician is now …" in the chat and in the window and
  still approves every connection. The previous technician loses access to the computer, its chat and its notes. Both
  accounts' activity records the handoff. Only a team technician of the current owner can be chosen.
- **Session history** is the existing support-link list (finished sessions for two days) plus the notes; the full audit trail
  stays in Activity.

## Not done

Handoff to someone outside the owner's team, shared control by two technicians at once, attachments in chat, and a chat
for permanently installed computers (their owner is at the keyboard or talks through another tool).
