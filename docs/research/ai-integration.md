# AI and computer-use integration: a small technical plan

Status: research, 2026-10-14. Not built, and not to be built before the items it depends on are real-device validated.

## Principle

An AI assistant is another kind of helper. It gets no machine authority from being able to call a tool. Beacon Remote stays the
authority for who may do what to which computer, and the computer's own person stays the approver. There is no second
transport for AI: it uses the same sessions, the same screen video, the same input channel and the same consent.

## What an assistant would need

| Need                        | Existing capability it maps to                                                 |
| --------------------------- | ------------------------------------------------------------------------------ |
| Find computers              | `GET /api/machines`, `GET /api/shared`, the support queue                      |
| Start a session             | `POST /api/machines/:id/sessions` (view or control), then the person's consent |
| See the screen              | The session's video; a frame is a decoded video frame at the viewer            |
| Move, click, type           | The `beacon-input-v1` data channel envelope (sequence, lease, bounded rate)    |
| Clipboard and files         | The clipboard channel and `beacon-files-v1`, each only if separately granted   |
| Read state, wait for change | Session state, connection quality, and frame differencing at the viewer        |
| End                         | `POST /api/sessions/:id/stop`                                                  |

## Shape

A local MCP server (stdio), run by the person on their own computer next to their browser or agent runtime. It is a thin
client of the existing web API with its own session, not a service Beacon hosts:

- **Tools**: `list_computers`, `request_session(computer, capability, display?)`, `screenshot(session)`, `pointer(session, x, y, button, action)`,
  `type(session, text)`, `key(session, combo)`, `scroll`, `wait_for_change(session, timeout)`, `session_status`, `end_session`.
  File and clipboard tools exist only when that permission was granted for the session.
- **Transport**: the MCP server is a WebRTC peer of the same kind as the browser viewer (headless Chromium via Playwright, or a
  small native peer using the Rust core). It receives video, decodes a frame on demand and sends input envelopes. Nothing about
  the Windows host changes.
- **Identity**: the assistant signs in as a normal account, or as a dedicated "agent" account the owner creates and adds to the
  team with the viewer or technician role (ADR 0037). Its capabilities are therefore exactly that role's, on exactly those
  computers, and revoking the member ends its sessions at once. No credential is passed to the model; the MCP server holds the
  session cookie and the model only sees tool results.

## Safety rules that must hold

- **Consent unchanged.** Every session still needs the person's Allow (or the owner's own policy for their own computer). An
  assistant cannot approve for the person, cannot raise trusted access, and cannot touch the host window.
- **Visible activity.** The computer's sharing indicator and the consent window already say who is connected. For an agent
  account the label says "AI assistant" (the account's declared kind), so a person is never unsure what is looking at their
  screen. The activity log records tool-level events: session started, input burst, file offered.
- **Bounded sessions.** Agent sessions have a short fixed maximum, an input-rate ceiling lower than a person's, and no
  unattended continuation: if the person's Allow lapses or Stop is pressed, input stops with the existing lease logic.
- **Sensitive actions need a human.** Control, file transfer, recording and clipboard are separate grants; for an agent they
  default off and are requested per session. Typing into a password field, running a command, or sending a file is the
  model's decision and the person's visible sharing indicator and Stop are the check; where a policy wants a stricter rule it
  belongs in the computer's consent options, not in the model.
- **Prompt injection is expected.** Screen content is untrusted input to the model. The server never takes instructions from
  video or chat text, and tool results never carry credentials, links to authorise, or approval state that the person would give.

## Plan, smallest first

1. A read-only MCP server: `list_computers`, `request_session` (view), `screenshot`, `end_session`. Verified against the
   fixture with a scripted client. This proves identity, consent and the viewer peer without any input risk.
2. Add pointer and keyboard with the lease and rate limits, behind a per-session control grant, and the "AI assistant" label.
3. Add `wait_for_change`, then files and clipboard if a real workflow needs them.
4. Document it for people running their own assistants, including the account to create and the team role to give it.

This does not require Phase 4 organization features, and it should not be started before the temporary-support flow and the
second-device acceptance runner are green on real devices.
