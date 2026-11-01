# Beacon Remote — product UX acceptance criteria

## Scope

Integrate the supplied **approved V6 workspace** AND the new surrounding product surfaces. They form one system. Do not redesign the application around these static pages or embed full HTML pages in a production React app. Implement the architecture idiomatically using the existing app/router/component/style system.

### Public website

- Navigation: Overview, Download, Support, Security; login and workspace calls to action.
- Unauthenticated users visiting “My computers” are sent through authentication, then restored to their intended destination.
- The landing preview is an illustration of inventory, not real live telemetry.
- Responsive phone layout: no horizontal overflow or hidden navigation links.
- Footer/privacy/terms must reference real policies when available; no fake links.

### Authentication

- Email/password and MFA states: initial, invalid input, incorrect credentials (generic), rate limit, challenge, timeout, recovery.
- Account creation and email verification exist only if the backend supports registration. Hide unsupported auth methods; don't simulate email delivery.
- CSRF, secure cookies/session expiry, authenticated routing, password reset, challenge validation, secure trusted-device/session revocation as appropriate to chosen identity architecture.
- Match the actual auth system; no invented OAuth provider / passkeys.

### Host installation / enrollment

- Windows installer release, platform/arch details, real publisher, signature status, checksum, version/date, rollback policy if implemented.
- Windows service/session helper separation and honest install progress/errors; installer handoff to native UAC rather than HTML imitation.
- Host pairing code exists only as a short-lived server-issued challenge; join/completion state must be synchronized across browser and native app.
- Explicit device naming and access policy; least-privilege initial state; revoke/regenerate machine identity safely.
- Accountless guest support is distinct from permanently enrolling a computer.

### Attended support

- Recipient sees requester identity, session ID, requested capabilities, allow once/decline, expiry and trusted-app indicator.
- “View only” is the default. Mouse/keyboard requires active consent; additional capabilities require separate authorization and UI.
- Denied/expired/canceled requests cannot start sessions. Timeout defaults to deny.
- During active session display a persistent, visible banner/tray indicator, identity of controller, current permissions, pause and hard Stop Sharing.
- Pause stops outgoing screen and input immediately. Stop invalidates session capabilities. On reconnect, server/host validates authorization before resuming.
- No deceptive OS window spoofing, no hidden remote control or bypass of system security.
- Recover from logoff, UAC, network loss, restart and host shutdown with truthful state and safe handling.

### Signed-in web workspace

- Use the original approved V6 shell/components: Computers, Sessions, Assist, Activity, Downloads, Settings, main viewer.
- Connect public, auth, install and consent states to existing V6 routes and data sources.
- No separate standalone portals with divergent typography/theming; only the native Windows host intentionally uses Windows-like chrome.
- Show pending/reconnecting/error/offline/revoked states in context, not just in global modal boxes.

### UX QA

- Verify 320px, 390px, 768px, 1024px, 1440px, 1920px including landscape phone.
- Keyboard: focus visible, Enter/Space semantics, Escape to close transient panels, dialogs focus trap, useful form errors and validation.
- Pointer/touch: minimum effective tap area where critical, menu placement, meaningful press feedback, reduced motion, no clipped critical approval controls.
- Themes: light, dark, system; Windows app should follow native appearance if supported.
- Security critical actions: do not replace permission grants with transient toast; clearly show results with retained state.
- Test required workflows with actual browser/Windows host integration before declaring production readiness.

## Prototype validation

The new product screens have been rendered and checked at 1440, 820, 390, and 320 widths with no horizontal page overflow after the final fix. The main user journeys were exercised in a Chromium renderer. This does **not** validate the native agent or backend, because both are simulated.

## Implementation order

First: public/auth routing, product identity consistency, installer and pairing UI, native permission approval, active host controls. Second: transport state and error/reconnection UX, account session management, support entry/recovery. Leave file transfer, terminal, multi-user enterprise features, and agent computer-use integration outside this pass.
