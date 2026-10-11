# Relay separation and maintenance handoff

The local development environments are separated. Production Coturn separation
is pending. See [ADR 0011](decisions/0011-independent-relay-ownership.md) for the
verified ownership and the missing live peer-policy/quota settings.

The deployable Remote-owned candidate is now in
[`infrastructure/oracle/remote-turn/`](../infrastructure/oracle/remote-turn/README.md).
It passed actual authenticated allocation, IPv4 forbidden-peer permissions,
foreign-secret rejection, combined admission limits and cleanup/recovery against
the pinned non-root image in an isolated local Docker fixture. See
[the validation record](relay-validation-2026-10-11.md). A standalone instance is
now deployed on Oracle and passed VM protocol checks with real separate product
secrets. Public TCP reachability and authenticated UDP relay-pair traffic passed
from Windows after the owner approved the three narrow Oracle ingress rules.
Remote acceptance now issues only the new relay URL/secret and passed forced-relay
synthetic playback. The owner confirmed Android mobile-data desktop connection
and Windows local Stop succeeded. Remote-only relay recreation preserved View's
container ID and start time; no live View camera call was available for testing.
No View restart window is agreed. The paired mapping
requires a documented exception for the exact isolated relay container address.

## Before changing services

1. Confirm View and Remote owners agree on the common peer-denial baseline,
   its immutable release copies and an aggregate free-tier resource budget.
2. Reserve Remote TCP/UDP 3479 and UDP relay range 49201–49240. Verify actual
   Coturn transport requirements before adding TCP relay-range rules. Check
   existing listeners, Oracle ingress and Docker/nftables forwarding. Do not
   expose database ports or introduce a broad firewall allow rule.
3. Create a Remote-only REST secret in a root-readable protected file, outside
   Git and logs. Keep View's secret unchanged. Do not print rendered Compose
   configuration containing secrets. Choose a distinct Remote realm.
4. Prepare a standalone `beacon-remote-turn` Compose deployment, isolated from
   application/database networks, using the currently patched image digest and
   concrete relay-IP wrapper. Pin ports, read-only config mounts, bounded logs,
   memory/CPU limits and aggregate allocation/bandwidth controls. Run Compose
   validation with `config --quiet`, then parser/security checks in an isolated
   test environment. An undeployed plan is not a passed runtime check.
5. Record old image IDs, mounted-file hashes, exact Compose invocation and
   protected backups. Confirm no capture is active before a disruptive change.

## Prove Remote independently

Start only the new Remote relay. Leave the shared View instance untouched.
Configure only the isolated Remote acceptance backend to issue the new relay
URL and secret. Production Remote media remains disabled until its media gates
are satisfied.

Prove authenticated allocation and permissions between public peers. Attempt
forbidden loopback, private, link-local, IPv6 unique-local and mapped-address
destinations with valid temporary credentials; require rejected permissions.
Check both instances against the denied-peer baseline, quotas, exhaustion recovery and
bandwidth limits. Read startup logs for invalid settings. Do not send secrets
or media contents into the evidence logs.

Run forced-relay synthetic playback and owner-approved desktop playback from
Windows to Android on mobile data. Verify the selected relay candidates use the
new port/range, consent visibility, local Stop, browser Stop, session expiry and
backend-loss shutdown. Recreating only the Remote relay must leave View's
container and an agreed View live call running. A container health check alone
does not prove this independence or media connectivity.

After acceptance, update Remote's intended media deployment configuration only.
Do not enable media on the private-alpha production site as part of relay
separation. Preserve the old acceptance configuration for rollback.

## Transfer and harden View's remaining relay

Arrange a maintenance window with the owner and View maintainer; record its
start, maximum duration and affected calls. No restart time is agreed yet.
Prepare View-owned copies of the patched image configuration and startup
wrapper. Move configuration ownership out of the mutable View application
release path, and remove the dependency on `/etc/beacon-remote/` in the final
View Compose invocation. Review these changes with Claude rather than editing
Claude's active checkout.

Apply the reviewed peer policy and limits, remove invalid options using supported
settings, then recreate **only** View's Coturn service during that window.
Confirm public relay, forbidden-peer rejection, quotas and both products'
health. Claude's View acceptance must include a relayed-only camera live view
on two networks beyond the credential lifetime, verifying fresh credentials and
ICE restart. That check remains separate from Remote's bounded desktop grants.

Until this transfer is complete, the current shared-service invocation requires
both files:

```sh
sudo docker compose --project-name beacon-secureview-cloud \
  --env-file /etc/beacon/production.env \
  -f /opt/beacon/app/infrastructure/cloud/compose.yaml \
  -f /etc/beacon-remote/turn-relay.override.yaml config --quiet
```

This validates Compose only; it does not restart or test Coturn. Do not apply the
original View Compose alone and accidentally restore its older relay image.

## Rollback

Before Remote cutover, stop only the new `beacon-remote-turn` service if its tests
fail; keep View's relay intact. After acceptance configuration cutover, restore
the previous protected acceptance TURN settings and restart only that backend,
which ends its current test session. Any View rollback uses the saved patched
image/configuration and agreed window. Never roll back to the old vulnerable
image as routine recovery, delete volumes, or reset shared firewall rules.

Record deployment hashes, actual external port reachability, security results,
call-interruption evidence and remaining limitations before declaring separation
complete. The standalone relay is deployed; production Remote media stays off.
