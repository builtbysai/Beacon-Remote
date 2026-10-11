# Remote relay candidate validation — October 11, 2026

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
