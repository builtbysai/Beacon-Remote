# Independent relay ownership

Date: 2026-10-11. Active milestone 4. Decision: separate relay instances;
deployment pending coordination and acceptance.

## Verified current state

The live `beacon-secureview-cloud-coturn-1` belongs to the
`beacon-secureview-cloud` Compose project. Its configuration is mounted from
`/opt/beacon/app/infrastructure/cloud/turnserver.conf`. The Compose invocation
also uses `/etc/beacon-remote/turn-relay.override.yaml`, which pins Coturn 4.13.0
and mounts Remote's concrete-container-IP startup wrapper. This is split
operational responsibility, not an unowned container. Applying View's original
Compose alone can revert the patched image and relay mapping.

The live mounted configuration and selected command arguments have no explicit
denied-peer ranges, user/total allocation quotas or bandwidth caps. View's local
configuration contains these settings, but they have not reached this server.
Runtime help reports `no-loopback-peers`, `no-tlsv1` and `no-tlsv1_1` as invalid
configuration options in the deployed image. Default loopback restrictions do
not substitute for the missing private-network deny policy. This remains an
unresolved security concern; successful public relay playback did not test it.

## Ownership after migration

| Resource                             | View                                           | Remote                                             |
| ------------------------------------ | ---------------------------------------------- | -------------------------------------------------- |
| Compose project                      | `beacon-secureview-cloud`                      | `beacon-remote-turn` (proposed)                    |
| Listener TCP/UDP                     | 3478, unchanged                                | 3479, proposed                                     |
| Relay port range                     | 49160–49200, unchanged                         | 49201–49240, proposed                              |
| Protected configuration              | View-owned `/etc/beacon-view/turn/` (proposed) | Remote-owned `/etc/beacon-remote/turn/` (proposed) |
| REST authentication secret and realm | View-only after cutover                        | New independent Remote secret and realm            |
| Restart authority                    | View maintainer                                | Remote maintainer                                  |

No listener was observed on the proposed Remote ports. That is not proof of
external reachability or an approved firewall reservation. Oracle ingress and
the host's Docker/firewall forwarding rules must be checked before deployment.
The host `iptables` command failed with a kernel compatibility error; nftables
tables exist. Do not flush or replace the shared firewall to resolve this.

Use isolated relay networks with no database/application network attachment.
Retain the patched image digest and concrete dynamic relay address behavior on
both instances. Each deployment must own its Compose file, configuration and
startup wrapper; neither can mount the other product's mutable release files.
Keep the existing shared instance running during Remote preparation and tests.
After Remote cutover, it becomes View's instance. Transfer the patched image and
wrapper into View-owned deployment configuration in a coordinated View change.

The VM, public IP, host networking, CPU and free-tier egress remain shared.
Separate instances isolate process/configuration restarts, not host failures or
aggregate bandwidth consumption. Size per-instance memory/CPU and allocation/
bandwidth caps within one agreed host budget. Do not silently double the proposed
40-allocation budget or provision paid resources. This budget is not currently
enforced on the live shared relay.

## Common security baseline

Use one reviewed, non-secret peer-denial baseline for both products, initially
the ranges in View's local `infrastructure/cloud/turnserver.conf`. Give each
release an immutable copy and record its SHA256; compare those copies before
deploying either service. A common baseline does not mean a live shared file
that either application release can change. Neither product may independently
relax the baseline. A separate infrastructure repository is deferred; agree its
canonical source with the View maintainer before cutover.

Do not enable `allow-loopback-peers`. Remove invalid flags only in a reviewed
replacement configuration with explicit denials and parser/permission tests.
Check the patched image's supported TLS options before replacing obsolete TLS
flags; do not infer that removing an invalid flag configures secure TLS.

## Migration and evidence gates

Follow [the coordinated relay runbook](../relay-separation.md). Starting an
independent Remote instance need not restart View. Changing View's mounted file
or recreating the shared instance requires an agreed maintenance window and
checks of both products until Remote is proven independent.

Remote must prove authenticated forced-relay synthetic and attended desktop
viewing, local Stop, bounded expiry and rejection of forbidden peers. View owns
its separate-network test extending beyond its TURN credential lifetime and
ICE restart. Remote's two-minute desktop authorization must not be extended to
imitate View's longer camera session. No desktop access, recording or input is
authorized by this infrastructure decision.

No relay, firewall, secret or live View file was changed for this decision.
