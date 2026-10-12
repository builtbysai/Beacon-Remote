# Cancellable attended desktop approval

## Context

The former Windows MessageBox blocked the helper's signaling reader until a
person chose Yes or No. Cancelling the request in the viewer, signing out or
losing signaling could leave an obsolete approval prompt open. Server state and
renewable leases still prevented capture from an ended request, but the host
could be asked to approve a request that no longer existed.

## Decision

Use an ordinary native window with explicit **Decline** and **Allow viewing**
controls. Decline starts focused and is the default. Close and Escape decline.
The prompt identifies the requesting account and explains primary-display,
view-only, two-minute access and the local Stop control. Tab/keyboard navigation
uses [IsDialogMessageW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-isdialogmessagew);
dimensions and text are scaled for system DPI.

Continue reading the authenticated WebSocket while the local prompt is open.
An ended message, transport close/error, malformed/repeated join or grant expiry
ends the wait. Already observable cancellation or expiry wins over a late dialog
result. A valid machine/desktop join is required before approval is forwarded.

The native window checks cancellation, its monotonic deadline and input-desktop
availability on a nominal 100 ms Windows timer and again when Allow is selected.
Timer delivery depends on normal OS scheduling; it is not a guaranteed shutdown
latency. Any query/window/font/timer failure denies sharing. Join the cancelled
dialog task before returning, with a bounded wait; never automate Allow.
The two-minute monotonic grant budget begins before signaling setup and includes
the person's response. Neither consent time nor a backwards wall-clock change
adds time to the grant.

Only destruction during an active message loop posts `WM_QUIT`. Cancellation
or an initialization failure before the loop starts must leave no quit message
for the next consent request on a reused blocking-pool thread. Error cleanup
after leaving the loop follows the same rule.

An approved prompt still creates no capture by itself. The visible Stop window,
connected peer, live server renewal and capture desktop checks remain required.
Disconnect/expiry/lock require a fresh request and fresh local approval. Input,
audio, recording, secure-desktop capture and automatic approval remain absent.

## Verification and remaining acceptance

Native checks use a real loopback WebSocket to end and close an unanswered
consent wait. Deadline and late-result fixtures cover expiry and cancellation
precedence, with no real dialog approval or screen capture. The hidden noninput
desktop regression also denies the new consent prompt, capture and cached
snapshots. Cancelled/expired requests are rejected before opening a window.
A real hidden-window regression checks destruction before, during and after
an active-loop lifetime on one Windows thread; only active-loop destruction
queues a quit message. It performs no approval or capture.

Actual Windows acceptance must verify visible text at normal/high DPI, default
Decline, Tab/Enter/Escape and close, cancellation while the prompt is open,
expiry, lock/secure-desktop behavior, fresh re-request, explicit human Allow and
local Stop. The broader desktop/network/performance matrix remains milestone 4's
release gate. Build/CI and synthetic protocol checks do not complete it.
