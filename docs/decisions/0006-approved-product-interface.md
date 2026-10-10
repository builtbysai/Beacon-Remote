# Approved product interface integration

The owner supplied Beacon-Remote-Final-Package.zip and explicitly requested that
its prompt be read, the package reviewed, and development continued. The package
is the approved visual and interaction direction. Its clickable prototype was
opened and its public, sign-in and workspace controls inspected before editing.

Integrate the design as React components in the existing Vite application.
Use the supplied blue/slate tokens and logo assets; keep simulated device data,
credentials, permission grants, downloads and transport states out of production.
Use fragment navigation for the small current surface, preserving the existing
invitation bearer removal from browser history. Protected workspace destinations
show authentication and restore the requested destination after successful login.

Expose bounded, account-scoped activity and view-request history from existing
tables, and browser-session expiry/current-browser information without tokens or
token hashes. Ending other browser sessions requires the existing exact Origin
and preserves the current browser and other accounts. No new database or service
is needed. Session history is unavailable when media is disabled, so the deployed
presence release does not need the media migration to render the interface.

MFA, recovery, accountless support, signed installer downloads, control and
pause/resume remain unavailable until their real security/backend capabilities
exist. Do not imitate UAC or present prototype approval as native authorization.
The native Stop window shows the real controller, view-only capabilities and
peer connection state. Capture consent, expiry and lease enforcement remain intact.

This pass does not complete media relay acceptance or authorize starting input.
Production readiness still requires native acceptance and the documented release
gates. The prototype is a design reference, not evidence that those features work.
