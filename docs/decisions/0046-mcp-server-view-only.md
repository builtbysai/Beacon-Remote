# 0046 — MCP server, stage one: view only

Status: accepted (stage one). Control, clipboard and files are not part of it.

## Decision

`tools/mcp` is a small MCP server (stdio) that lets an AI assistant look at a computer through the real web viewer. It signs in as an ordinary
account, lists computers, and asks for a view session exactly as a person would in the browser. A headless Chrome runs the web app; the picture is
read from the viewer's `<video>`.

Tools: `list_computers`, `request_session` (view only), `screenshot`, `session_status`, `end_session`.

## Why this shape

- No new authority: the assistant can do only what the account's browser can. The person at the computer still sees a request that names the
  account and must allow it; trusted-access machines behave as they already do for that account.
- No parallel connection code to secure: the viewer is the single place that negotiates sessions, consent, indicators and limits.
- Bounded: one session at a time, a hard time limit (default 600 s, 30–3600), ended on shutdown or signal.
- Revocable at once: the person's Stop button, revoking the account's access, or ending the session in the web app all work unchanged.
- Credentials come only from environment variables and are never logged. Use a dedicated account without two-step sign-in, or a session cookie.

## Not done

Pointer, keyboard, clipboard and file tools (each needs its own consent design and a per-tool allow list), more than one session, and any
cloud-hosted use. Screenshots go to the assistant's provider, so the README says to use it only on computers whose owner accepts that.
