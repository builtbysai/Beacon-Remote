# 0064: Semantic UI targets for agents

Status: proposed November 27, 2026. The pure core is built and unit-tested (`tools/mcp/src/ui-snapshot.mjs`: bounded
snapshots, protected fields without text, snapshot-scoped references, expiry, receipts without element text). The
Windows reader is built too (`apps/windows-session/src/ui_tree.rs`, UI Automation: role, name, state and box only, a password
field with no name, never invoking or changing anything) and was checked against the live taskbar on a development machine,
whose real tree went through the snapshot code (18 nodes, 12 buttons, a button resolved). Nothing else is built: nothing
calls the reader, no tool exposes it, and the closed tool list is unchanged, so it widens no authority
until the owner approves wiring it up. Builds on [0046](0046-mcp-server-view-only.md) (view only) and [0052](0052-agent-control-consent.md)
(control consent). Part of P3-3 "better agent experience".

## The problem

An assistant that only sees screenshots and sends pixel coordinates guesses where things are and clicks blindly. A
semantic target (a named button, a text field, a menu item with its role and state) lets it act precisely, check what
happened, and stop when the screen is not what it expected. It also reads far more than a screenshot does, so it needs its
own consent and its own limits.

## Decision

1. **A separate scope, not part of "control".** Reading the interface tree is a new closed-list tool, `ui_tree`, that the
   owner grants on the computer exactly as 0052 describes for the other tools, with the same one-hour limit, the same
   visible indicator and the same Stop. Control without `ui_tree` stays pixel-only; `ui_tree` without control is read
   only. Neither implies the other.
2. **Targets are references into a snapshot, never raw handles.** The host returns a snapshot with a number and expiry
   (seconds). A command names `{snapshot, ref}`. A stale snapshot, an unknown ref or a window that changed refuses the
   command and says why; it never falls back to clicking the old pixel position.
3. **The host builds the tree, bounded and filtered.** On Windows from UI Automation and on Android from accessibility
   nodes, only for the foreground window of the shared display, at most a fixed number of nodes and depth, and only
   role, name, state, bounds and a stable per-snapshot ref.
4. **Secrets are never in it.** Password and other protected fields come back as a role with no value; the host
   already refuses protected content capture and applies the same rule here. Names longer than a limit are cut. The
   secure desktop, UAC prompts and other users' sessions are not described at all, matching the current Session 0, UAC
   and UIPI boundaries.
5. **Acting through a target is still control.** Activating a ref goes through the same gate as a pointer or keyboard
   command: scope, idempotency key, rate limit and a receipt (the receipt names the role and the ref, not the text of
   the element or anything typed). The host performs it as ordinary input at the target's current bounds, so UIPI still
   applies; it does not call an accessibility "invoke" that could reach what input cannot.
6. **Failure is explicit.** If the tree is unavailable (a game, a remote desktop window, an app without accessibility
   support) the tool says so and the assistant falls back to screenshots; it is never given a guessed tree.
7. **Privacy of the tree itself.** It is sent only to the approved assistant session, never stored by Beacon, and not
   written to logs; the same rule as screenshots (they go to the assistant's provider, so the owner must be told that
   the tree does too).

## Not decided here

- Whether the Android host exposes the same tool before the Windows one does (it has more accessibility restrictions).
- How Motive consumes snapshots (a separate record when Motive is designed).
- Any change to the closed tool list in `agent-scope.mjs`; that waits for owner approval of this record.

## Checks that would settle it

- Unit tests with fabricated trees: a protected field has no value, depth and node limits hold, a stale snapshot refuses,
  a ref from another snapshot refuses, and a receipt carries no element text.
- A device run on Windows with a real app and with a password box, and on Android with a settings screen, confirming that
  the tree matches what is on screen and that the password field is empty in it.
