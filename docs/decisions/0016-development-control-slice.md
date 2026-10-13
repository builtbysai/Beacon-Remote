# 0016 — Independent implementation and attended development control

> Superseded in part by [ADR 0021](0021-access-policy-and-session-lifecycle.md): control sessions are no longer limited to two minutes, and a computer may be set to trusted access.

Date: 2026-10-12

The owner explicitly replaced sequential milestone implementation with independent
feature tracks and per-feature release gates. Existing media evidence is retained;
unresolved real-device acceptance does not prevent input, installation or UI work.

Control is a separately requested two-minute `desktop:control` session, with
server ownership checks, one live machine session, a scope-bound single-use token,
explicit native Allow control and visible Stop. A view session cannot be upgraded
implicitly. This initial slice requests view plus control together; separately
approving control during an already active view remains a future interaction.

Backend `DEV_CONTROL_ENABLED=true` is rejected in production. Native
`REMOTE_DEV_CONTROL=true` is also required. Input is injected by the existing
unprivileged interactive helper with SendInput; UIPI failures stop control. No
service, elevation, UIAccess, secure-desktop or UAC workaround is added.

One ordered reliable DataChannel carries bounded typed inputs. Browser pointer
movement is coalesced to animation frames and flushed before buttons/scroll/keys.
This keeps drag coordinates ordered while avoiding a second-channel ordering
problem. Physical display dimensions travel from Windows to the browser; encoded
video dimensions and letterboxing are accounted for. A layout change ends control.
Only the primary display is supported by the current capture path.

The native owner tracks held keys/buttons, releases them on drop/Stop/error and
checks authority without waiting for an input packet. Control disconnect terminates
the entire approval, even though view-only sessions retain bounded reload recovery.
A missing input heartbeat ends control after 1.5 seconds; the existing server
renewal lease independently bounds revocation/network failure. Focus loss/Escape
releases input. Escape stays local as the reliable browser escape hatch.

Limitations: browser/OS-reserved shortcuts cannot all be captured; IME/touch
keyboard entry and multi-display control are not complete. SendInput cannot
promise cleanup after forceful process termination or OS failure; a crash watchdog
belongs to the installation/service work. No input contents are logged or stored.
Actual OS input, held-state release, elevated-window refusal, lock and cross-network
control need human/device acceptance before any release enablement.

Failed SendInput key/button releases are retried for up to three seconds on the
ordinary input desktop after session authority has ended. A persistent UIPI/lock
block or forceful process death can still prevent release; the helper reports
that failure and never revives control. This remains an unverified release gate
requiring an elevated-window/lock held-input acceptance test and a durable cleanup
owner in the installation track.
