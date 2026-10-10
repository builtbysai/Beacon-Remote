# Session-scoped relay credential foundation

Date: 2026-10-10. Status: backend/peer integration and Windows CI passed;
browser-only synthetic relay passed, dual-relay permission was rejected, and
distinct-public-network desktop acceptance remains incomplete.

Follow-up: Windows CI also passed at `543988f`. Additional safe browser diagnostics
showed both peers obtained relay candidates in the failed dual-relay test. A
comparison with only the browser forced to relay decoded synthetic H.264, including
444 presented frames, and browser Stop ended the stream. The native side used the
existing Tailscale path; distinct-public-network desktop viewing remains unproven.
The comparison used a temporary local browser policy override, restored afterward;
normal product policy still comes from the authorized grant. No production rollout
or shared relay configuration change occurred.

A bounded header-only TURN error probe on the existing relay observed Allocate
`401` (the normal authentication challenge) followed by CreatePermission `403`
in a repeated dual-relay session. Both peers had relay candidates; permission to
exchange traffic between the allocations was rejected. This locates the current
dual-relay failure at the relay permission boundary, not credential issuance.
Existing no-loopback/protected-peer controls were retained. General fallback
cannot be called ready until restrictive-network peers are accepted without
weakening those controls. The probe printed only numeric method/error codes;
addresses, transaction IDs, usernames, credentials and payloads were not retained.

Chrome reported the selected local candidate as `prflx` despite relay-only policy.
Diagnostics now honor the enforced policy and leave ambiguous peer-reflexive
paths unavailable rather than calling them direct. Diagnostics remain accessible
before decoding and after failure, showing state, candidate counts/types and numeric
server errors without addresses or credentials. Native state/lease-stop messages
likewise exclude grants, SDP and candidate addresses.

Registry source for the current webrtc 0.21.0 async TURN driver skips secure and
non-UDP TURN URLs. Backend startup and native validation now reject TCP/TLS TURN
instead of accepting an unusable configuration. This is an explicit current
transport limitation, not a recommendation to disable TLS elsewhere.

Validation of this follow-up: `pnpm check` passed with real PostgreSQL and no
database checks skipped; production dependency audit found no known vulnerabilities.
Windows formatting, Clippy, tests and release build passed for `c7fc58c` in
[CI run 38076047160](https://github.com/builtbysai/Beacon-Remote/actions/runs/38076047160).
The updated matching agent/helper artifacts were downloaded for bounded native
acceptance. These checks validate the implementation, not the unresolved relay
topology or public-network desktop acceptance.
The matching `c7fc58c` helper ran a further bounded dual-relay synthetic test:
native logged connecting and then sharing stopped; browser retained disconnected
ICE, one relay candidate per peer and zero decoded frames. The test captured no
desktop. Its temporary account, native identity and exported relay secret were
removed afterward; production and Beacon View remained unchanged.

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
