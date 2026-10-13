# 0022 — The Windows host runs in the signed-in user's session; no service yet

Date: 2026-10-12

## Decision

The Windows host stays a per-user program. It is installed without elevation, can be set to
start when the user signs in (a visible checkbox in the host window, stored under the user's
`Run` key) and then goes straight to the tray and comes online. It keeps its Ed25519 identity,
trusted-access setting and display list under the user's profile, so a restart needs no
re-pairing and no second prompt. We do not install a Windows service in this phase.

## Why

- Capture and input must happen in the interactive session of the person who owns the
  computer. A service lives in Session 0 and would still need a per-user helper for both,
  plus restricted IPC between them, for no extra reach.
- Reaching the sign-in screen, UAC prompts or the secure desktop would need SYSTEM-level
  capture and input. The product rule is not to bypass UAC, the secure desktop, UIPI or
  Session 0 isolation, so unattended access to a locked or signed-out computer is out of
  scope by design, not by omission. When Windows locks, sharing ends (ADR 0021).
- A service adds installer, update and attack surface (a privileged process that accepts
  network-driven work). That cost needs a concrete requirement that per-user cannot meet.

## What it covers

Trusted personal access (ADR 0021) while the owner is signed in, including after reboot and
sign-in, network changes, backend restarts and browser refresh.

## Revisit when

A real need appears for presence while nobody is signed in (for example showing a computer as
"asleep, will be online at sign-in" or wake support). That would be a small presence-only service
that holds no capture or input authority and is introduced with its own decision.

## Installer

`packaging/windows-development` remains the unsigned internal package. A consumer installer
and signed updates wait for a legitimate code-signing certificate; nothing is signed with a
placeholder.
