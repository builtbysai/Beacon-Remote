# Session-scoped relay credential foundation

Date: 2026-10-10. Status: backend/peer integration implemented and Windows CI
passed; actual forced-relay acceptance failed and remains unresolved.

Milestone 4 cannot finish with STUN-only local acceptance. Use existing Coturn
REST authentication rather than static client credentials or another service.
Coturn's [official configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)
defines timestamped usernames and base64 HMAC-SHA1 passwords. SHA-1 here is the
protocol's keyed credential mechanism, not password storage.

`TURN_URLS` and `TURN_SECRET` must be supplied together and require enabled media.
URLs use explicit configured hosts/ports/transports; clients cannot choose a
relay target. The shared secret remains backend/operator-only. Do not commit it.
The endpoint is an exact-Origin authenticated owner POST on a specific live
session; revoked machines, ended/denied/expired sessions and foreign owners are
rejected. Rate limiting and existing no-store/log-redaction policy apply. The
username contains an opaque session UUID, no email or computer name. Expiry is
rounded down to a second and never extends the existing session deadline.

Configured relay credentials now travel in both browser creation grants and
signed machine heartbeat responses. The helper validates session-bound username,
bounded URLs/password fields and all/relay policy before consent or RTC setup.
Both peers use default policy `all`; operator-only `relay` requires TURN and
supports forced-relay acceptance. Browser diagnostics classify the selected
candidate pair as Direct or Relayed without displaying network addresses.
Matching helper/backend/web builds are required. This integration is not real
relay acceptance or evidence that production media can be enabled. Production
and shared Coturn configuration are unchanged.

TURN credentials are bearer credentials. Coturn authenticates the timed username,
not Beacon's session state or intended peer; it cannot instantly revoke issued
credentials when a session ends. An allocation can also outlive credential expiry
under relay allocation policy. The native authorization lease and Stop must
terminate capture independently. Quotas, allocation lifetime, protected-peer
restrictions and real relay usage require acceptance before rollout. Do not claim
per-peer authorization, instant allocation revocation or end-to-end identity.

Validation: full local `pnpm check` passed with real PostgreSQL. Route checks
exercise anonymous/foreign-owner/wrong-Origin rejection, disabled configuration,
live states, ended/denied/expired sessions, machine/browser revocation, no-store,
rate limiting and the expected Coturn HMAC/expiry. Startup checks reject partial
configuration, embedded URL credentials and invalid ports/transports. An initial
test-helper UUID type inference error was corrected before the final passing run.
Follow-up PostgreSQL signaling checks confirm both peers receive identical
credentials and relay policy. Windows formatting, Clippy, tests and release build
passed for `d64854f` in
[CI run 38066791856](https://github.com/builtbysai/Beacon-Remote/actions/runs/38066791856).
Local native compilation remains unavailable because MSVC `link.exe` is absent.
Using matching CI binaries, two actual relay-only synthetic attempts through
existing Oracle Coturn stopped before decoding or a selected route could be
verified. The second browser reported “Video connection interrupted.” Root cause
is unresolved; successful allocation and native relay connectivity are unproven.
No desktop capture or production rollout occurred. A delayed playback rejection
also overwrote the ended status; the browser now ignores it after shutdown.
