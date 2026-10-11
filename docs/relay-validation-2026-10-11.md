# Remote relay candidate validation — October 11, 2026

## Later Oracle deployment checks

The standalone `beacon-remote-turn-coturn-1` is now running on the existing VM,
with its own secret, bridge and named volume. The isolated Remote acceptance
backend now issues only the new UDP 3479 URL and dedicated secret; its previous
protected settings are retained for rollback. Production media remains off and
the shared View relay has not been restarted.
The initial release is `/etc/beacon-remote/turn/releases/805ecbd`; a derived
`805ecbd-paired-map` release fixed the public/self mapping described below.
The final deployed source is immutable release
`d9b7bc3880d18c0bf54ff99e107c899aac27fdd6` under the same releases directory.
Operator settings and the dedicated secret are in protected files under
`/etc/beacon-remote/turn/`, outside Git. No paid resource was created.

Actual VM protocol checks passed own-secret allocation, forbidden IPv4 peers,
combined admission limits and release recovery. New Remote credentials were
rejected by the old View relay, and actual old View credentials were rejected
by the new Remote relay. Neither real secret was printed. A protected temporary
View-secret fixture was used solely for those checks.

The single-address external mapping failed permission to the VM's own public
IP, returning 403 after mapping it into the container's private range. The
supported paired `public/private` mapping corrected that. Coturn's
[versioned implementation](https://github.com/coturn/coturn/blob/4.13.0/src/apps/relay/mainrelay.c)
automatically whitelists the exact private relay address for paired mappings.
This is an explicit self-relay exception, not proof that all private addresses
are denied. It is limited to this isolated Coturn container; it must never join
an app/database network. The private deny baseline remains unchanged and the
tested forbidden peers still returned 403. The actual VM public IP permission
also passed after this correction. Random probe bytes passed in both directions
between two allocations on the VM. End-to-end media remains unproven.

Oracle sign-in was restored. The VCN is in the root compartment, while the VM is
in `beacon-staging`; the subnet is `10.0.0.0/24`. Its default security list only
permits SSH and ICMP ingress. The owner approved adding exactly three stateful
ingress rules to its attached `beacon-nsg`: TCP 3479, UDP 3479 and UDP
49201–49240 from `0.0.0.0/0`. Oracle visibly saved those rules; the existing View
rules remain unchanged. From the Windows workstation, public TCP connection and
authenticated UDP allocation passed. Both advertised relay addresses used the
Remote public IP/range, and random probe bytes passed in both directions through
those allocations. Only two-minute test credentials left the VM; the long-lived
secret remained in its protected file. The temporary local credential file was
removed after the check. This proves public protocol traffic, not browser video
or a separate-network Android call.

After confirming no unexpired live acceptance grant, only the acceptance backend
was recreated. Chrome's synthetic video test connected with forced relay policy,
reported relay/relay candidate types, decoded frames and approximately 30 FPS.
Browser Stop removed the video and ended the native test. This checks no desktop
pixels, audio or input. An owner-approved Android mobile-data desktop test remains
pending. Exact selected candidate ports were not exposed by this viewer's UI;
use of the new relay is supported by the backend's sole new TURN configuration
and successful playback, rather than a displayed selected-port statistic.

An admission-limit probe run during playback, and repeated immediately after
browser Stop, returned 486 before four new allocations. Browser allocations can
remain reserved until their TURN allocation lifetime expires. The check must run
with no residual allocations; it must not interpret occupied capacity as a quota
regression. After verifying no live acceptance grant, the Remote relay alone was
recreated from the committed immutable release. The clean-state protocol check
passed four admitted allocations, excess rejection, release recovery, private
peer rejection, real View credential rejection and the bidirectional relay pair.
View retained container ID
`10db9f6387816f054c9b0f30e94de7d5b539c1ad6808b68ae92890d40b631352`
and start time `2026-10-10T19:11:30.861346752Z` throughout. A live View camera call
was not available for interruption testing. Forced-relay synthetic playback
passed again after the Remote-only recreation and Browser Stop ended it.
The temporary protected View-secret fixture was then removed; actual View
configuration and credentials were untouched. Remote production readiness passed.
Coturn emitted a PID-path warning before falling back successfully to its writable
`/tmp/turnserver.pid`; no invalid-option warning was observed.

## Final attended Android acceptance and maintainer handoff

The owner confirmed desktop viewing connected successfully on Android using
T-Mobile mobile data and stopped successfully with the Windows local control.
The isolated native agent reported local-consent-required desktop mode, connected
peer state and sharing stopped. No audio, recording or input was enabled. This
provides owner-reported separate-network desktop acceptance; the earlier exact
selected-port visibility limitation still applies.

Remote's acceptance backend and relay now operate independently of View's TURN
secret, ports, container, configuration and volume. Production Remote media stays
disabled. View can prepare its own ownership transfer next, but its restart must
wait for an agreed maintenance window. Keep the old patched relay and its Remote
override intact until View's replacement configuration and rollback are ready.
View still needs its own relay-only camera test beyond credential lifetime,
private-peer rejection and cross-product credential rejection after hardening.

Local validation passed formatting, lint, type checking, backend/web builds,
Python compilation, shell syntax and real TURN protocol probes. The initial
`pnpm check` had database regressions skipped without `TEST_DATABASE_URL`; a
separate `pnpm test` run against Remote's local `beacon_remote_test` database then
passed those regressions without skips. Native source was unchanged; this work
used the previously built Windows acceptance binaries rather than recompiling.
The following local fixture record describes the earlier candidate, before this
VM deployment.

View ADR 0114 was read from its active checkout without editing it. Its migration
order agrees with Remote ADR 0011. One factual clarification for the View
maintainer: the running relay has Compose ownership labels referencing both the
View source Compose file and the Remote override; it is not an unmanaged
container. View's claim that its hardened local configuration is not deployed
agrees with the live inspection.

## Candidate implementation

Standalone project `beacon-remote-turn` uses its own bridge, named state volume,
listener 3479 and UDP range 49201–49240. It mounts no View files and joins no
application/database network. Coturn is pinned to the same patched 4.13.0 digest
as the live shared service. The non-root startup wrapper merges a dedicated
protected secret file into a private tmpfs; the secret stays out of argv,
environment, Git and rendered Compose. Logs and CPU/memory/admission are bounded.

The denied-peer baseline matches View's local reviewed configuration. The
runtime is explicitly plain TURN UDP/TCP; TLS/DTLS and TCP peer relays are
disabled, so obsolete TLS flags are absent. Coturn's versioned
[official configuration](https://github.com/coturn/coturn/blob/4.13.0/examples/etc/turnserver.conf)
documents the listener/relay distinction and supported settings.

## Actual protocol evidence

An isolated local Docker network and container ran the pinned image with the
candidate wrapper/config, a loopback-only UDP listener on 53479, read-only root,
non-root UID 65534, capability restrictions and resource caps. Secrets were
random disposable fixtures in ignored local state; no real product credential
was read or transmitted for these tests.

`scripts/check-turn-policy.py` performed real STUN/TURN requests with HMAC
authentication. It verified authenticated success response integrity and
lifetime-zero allocation release. Observations:

- Own-secret credentials obtained an allocation and public IPv4 peer permission.
  No payload was sent to that peer.
- Private, loopback, link-local, carrier-grade NAT, reserved and multicast IPv4
  peer permissions returned 403.
- Credentials signed with a distinct fixture secret returned 401.
- Four concurrent allocations were admitted; an excess allocation returned 486.
- After confirmed release and asynchronous cleanup, an allocation succeeded
  again. Coturn acknowledges lifetime zero before finishing allocation cleanup;
  the probe waits briefly before checking recovered capacity.
- The final startup logs contained no invalid-option or filesystem-permission
  warnings. Compose `config --quiet` and Python compilation passed.

Repository formatting, lint, TypeScript checks, real Remote PostgreSQL
regressions and backend/web builds passed with `pnpm check`. Shell syntax and
the resulting diff were reviewed. Native Rust source was unchanged; native
compilation was not repeated for this infrastructure change.

Startup tests caught and corrected non-root tmpfs ownership and the bounding
capability required by the upstream executable. Initial extra IPv6 denial
entries incorrectly rejected public IPv4 permissions in this runtime; those
extras were removed and the candidate now uses View's baseline unchanged.
Do not generalize these IPv4 tests to IPv6/mapped-address safety.

## Limits and unchanged production

Admission evidence checks the combined user-quota/bandwidth-reservation limit,
not each quota independently. Actual throughput, aggregate VM budget, IPv6
permissions, real View-secret rejection, Oracle public ingress, end-to-end
playback and independent live-call survival remain unproven. Configuration
limits alone do not satisfy those acceptance gates.

Oracle opened to sign-in; the owner was asked to restore the console session for
network ingress inspection. SSH remains available. No new Oracle resource,
firewall rule, production secret, relay listener or View application file was
changed. The shared relay's container ID and start time remained unchanged:
`10db9f6387816f054c9b0f30e94de7d5b539c1ad6808b68ae92890d40b631352`,
`2026-10-10T19:11:30.861346752Z`. Remote separation must not be reported complete
until cutover and its acceptance evidence pass.
