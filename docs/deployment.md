# Deployment gates

October 12 (evening) manual rollout: merged main
`410a7d19cb0eec2fc0032b8c3e09854b8d4f699a` (PR 34: ADRs 0021-0024) is the current
Remote production release, after encrypted backup/integrity check, rollback tags
`rollback-74a4e6e`, additive migrations 005-008, schema/role verification and public
health/readiness for both products. The owner then authorized going live, so production
now runs with sessions, remote control and the dedicated relay enabled: the backend reads
`SESSION_SECRET`, `CONTROL_ENABLED`, `TURN_URLS`, `TURN_SECRET` and `ICE_TRANSPORT_POLICY`
from root-only `/etc/beacon-remote/production-media.env` through the compose override
`/etc/beacon-remote/production-media.override.yaml` (outside Git). Include that override on
every compose command that recreates the backend, or media silently turns off. Predecessor
`74a4e6e` images are tagged for rollback; the additive schema is compatible with it.

October 12 manual rollout: exact feature-branch source
`74a4e6e4d6573836c3da6dfc766b4c84c90c02e7` is the current Remote
production release, media disabled, after local control-plane validation,
encrypted backup/integrity, isolated restore, schema/role verification, and
both products' HTTPS health/readiness. The predecessor `4ea7ad9` images remain
tagged for rollback. See [the October 12 record](validation-2026-10-12.md).

Previous manual rollout on October 11: exact merged main
`4ea7ad97eac00ca6b8b33f7c168aa34e5a2f4d28` replaced ff452ff with media disabled,
after local control-plane checks, encrypted backup/integrity, isolated restore,
migration/role verification and both products' HTTPS readiness. ff452ff images
remain tagged for rollback. See validation-2026-10-11.md. Historical release
details below retain earlier evidence; they do not identify today's current link.

The private-alpha control plane is deployed at `https://remote.builtbysai.com`.
The approved interface now runs exact release
`ff452ffe66dd600e9a7b18d12fccc08ac970a7d6`, with encrypted pre-rollout backup,
schema/role verification, public health and real browser account acceptance.
Production media remains disabled; the prior release/images are retained.
See [the interface validation](product-interface-validation.md).
Exact hosting release `771b4081f2243b214e4333058a07ce5a6466badb` passed production
schema/role verification, public HTTPS health/readiness and encrypted OCI backup,
integrity and separate-database restore verification. Its independent daily backup
timer is enabled. Runtime release `2c8f944c5e44ff765baa1671a70ea9202b9b688c`
also passed public native Windows enrollment, online/offline presence, restart
and revocation using a temporary account. The testing account is provisioned;
local attended viewing works, while production viewing/control remain unavailable.
Keep existing Caddy/PostgreSQL/Coturn
services and Beacon View rollback releases intact.

`infrastructure/oracle/compose.yaml` supplies the isolated production containers.
Use a root-owned mode-0600 environment file outside the checkout containing
independent random hex `REMOTE_ADMIN_PASSWORD` and `REMOTE_DB_PASSWORD` values.
Never use development passwords. The private subnet is 172.30.88.0/28; inspect
existing Docker/host routes for overlap before creating it. The shared external
`beacon-edge` frontend network and View's Caddy product-import support must exist
before starting Remote's web container. Install the reviewed `edge.caddy` fragment
into View's root-owned products directory and validate/reload Caddy gracefully.
The DNS A record is DNS-only to match the existing direct TLS deployment.

Deploy only a validated exact commit under `/opt/beacon-remote/releases/<sha>`.
Run one backend instance per Remote database. Stop the previous instance before
starting its replacement; overlapping or rolling backend replicas are unsupported.
The backend acquires a database-scoped session advisory lock before recovery;
duplicates fail without ending the owner's grants. Its dedicated ownership
connection must go directly to PostgreSQL or through a session-preserving proxy,
not transaction pooling. Budget one connection in addition to the request pool's
maximum of eight. Detected ownership connection loss stops the backend immediately;
the normal restart policy may then start a replacement.
Startup atomically ends persisted live view grants and records interruption
events before listening. It fails closed if recovery cannot commit. Existing
native leases expire independently; reconnect requires a new request and local
approval. This also releases busy computers after an abrupt process crash.
Build backend/migrate/verify/web images, start PostgreSQL, explicitly run `migrate`
then `verify`, and start backend/web only after both pass. The application role
must be non-superuser with no role/database-creation rights. Retain the previous
release/images for rollback; do not use `compose down` or delete data volumes.
See [the hosting decision](decisions/0003-isolated-oracle-control-plane.md).

Use a separate PostgreSQL database/role and private network; bind backend only
inside that network. Route a dedicated HTTPS origin through Caddy and require
`WEB_ORIGIN` to match it exactly. No PostgreSQL or development HTTP ports should
be public. Set production Secure cookies; restrict proxy trust to the known
proxy network, configure rate limiting for actual client IPs, and add CSP,
frame-ancestors, HSTS and static asset headers. Use WSS for later signaling.
Assign memory/CPU limits, health checks, bounded logs and restart policy.

## Shared relay address mapping

The existing Coturn 4.6.3 service needs a concrete relay address. A wildcard
`relay-ip` maps same-server public peers to a zero address and CreatePermission
returns `403`. The isolated mapping reproduction returned `200` with a concrete
relay address; a subsequent Windows/Chrome synthetic test selected relay/relay
and decoded frames. This does not prove distinct-network desktop acceptance.

The override also pins official Coturn 4.13.0 by digest. The previously installed
4.6.3 is covered by the maintainer's
[mapped-loopback bypass advisory](https://github.com/coturn/coturn/security/advisories/GHSA-w4hf-cr3w-6h79).
Isolated checks on 4.13.0 accepted concrete mapping and rejected ordinary IPv4
and IPv4-mapped IPv6 loopback permission requests, including an IPv6 allocation.
The updated shared service reports 4.13.0 and both products' health/readiness
passed. The prior mapping-only override is retained at
`/etc/beacon-remote/turn-relay.override.pre-4.13.0.yaml` for emergency rollback;
that older image is not an acceptable consumer-release baseline.

Install `infrastructure/oracle/turn-relay-entrypoint.sh` and
`turn-relay.override.yaml` as root-owned, mode-0644 files under
`/etc/beacon-remote/`. The wrapper resolves the existing single-network container's
IPv4 on each start and fails closed for wildcard, loopback, IPv6 or multiple
addresses. It preserves the original arguments, credentials and peer protections.
No port, paid resource or View repository change is needed.

Validate and apply only Coturn with the existing protected environment:

```sh
sudo docker compose --project-name beacon-secureview-cloud \
  --env-file /etc/beacon/production.env \
  -f /opt/beacon/app/infrastructure/cloud/compose.yaml \
  -f /etc/beacon-remote/turn-relay.override.yaml config --quiet
sudo docker compose --project-name beacon-secureview-cloud \
  --env-file /etc/beacon/production.env \
  -f /opt/beacon/app/infrastructure/cloud/compose.yaml \
  -f /etc/beacon-remote/turn-relay.override.yaml up -d --no-deps coturn
```

Include this override in future shared relay maintenance. Applying the original
Compose file alone to Coturn removes the wrapper and restores the prior mapping
failure; that command is also the rollback. Retain the original files and never
print rendered Compose configuration or container command lines containing
secrets. A Coturn replacement interrupts its allocations; preserve app services
and verify both products' health/readiness afterward.

## Encrypted recovery

OCI's signed-in bucket page verified approximately 33.57 KiB usage against its
20 GiB free combined object/archive allowance; the existing `beacon-backups`
Standard bucket is private. Use a separate `beacon-remote` Restic prefix and a new
independent encryption password. Only ephemeral host backup operations receive
the existing OCI S3 credentials; backend/frontend never receive them. Do not
initialize, prune or change the existing View repository or enable its timers.

Root's Remote environment adds `REMOTE_BACKUP_REPOSITORY`,
`REMOTE_BACKUP_PASSWORD`, `REMOTE_BACKUP_ACCESS_KEY_ID` and
`REMOTE_BACKUP_SECRET_ACCESS_KEY`. Supply these without displaying values.
Build the operations backup/restore images; run `backup init`, `backup run`, and
`backup check`. Then run `restore-check` with
`REMOTE_ALLOW_ISOLATED_RESTORE=RESTORE_A_SEPARATE_DATABASE` while writes are
quiesced. It creates only the fixed new `beacon_remote_restore_check` database,
refuses any existing target, checks restored schema/aggregates without printing
contents, and removes only the target it created. Never restore over live data.

The initial backup policy refuses dumps over 32 MiB and retains daily/weekly/monthly
snapshots within a small fraction of the verified free storage. Larger data or
other bucket growth requires fresh quota/billing review. Restic encrypts before
upload; successful dump completion is checked before stdin is backed up. Keep
the encryption key and recovery credentials outside the VM as well, protected
for the owner, so losing the VM does not destroy the recovery path. Install the
new Remote-only timer after the host backup/restore drill passes, and verify its
status. A root-owned `current` symlink selects the validated Remote release.

Apply migrations explicitly and verify schema, establish encrypted backups and
an isolated restore drill, then deploy a validated exact commit. Verify HTTPS,
database readiness, login, pairing, signed presence, revocation, restart and
Beacon View health independently. Do not reuse local test passwords. General
consumer access additionally requires the account lifecycle/security gates in
`security.md`. Never expose an unfinished input/capture endpoint.

## Operator invitation

After migration, an operator may run the compiled
`apps/backend/dist/apps/backend/scripts/create-invitation.js` inside the backend
image with its existing restricted database environment. Capture the output
privately: it is a bearer invitation and must not enter operational logs or chat.
Open the generated HTTPS URL for the owner; the fragment is removed immediately.
The owner enters and submits their password themselves. Invitations expire after
30 minutes and cannot be reused. Reloading the setup page discards the token;
issue a replacement if needed. This does not enable general registration.

## Weekly restore drill

`beacon-remote-restore-drill.timer` runs `restore-check` every Sunday at 05:30 UTC (after the 04:30 backup). It
restores the latest encrypted backup into the fixed throwaway database, checks that the restored schema matches the
live one and that accounts survived, then drops only what it created. Counts are not compared because the live
service keeps changing (guest accounts expire); run the manual check below while writes are quiesced for that.
Install once, after building the operations images (`docker compose build backup restore-check`):

```
sudo cp infrastructure/oracle/beacon-remote-restore-drill.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now beacon-remote-restore-drill.timer
sudo systemctl start beacon-remote-restore-drill.service   # first drill now; see journalctl -u beacon-remote-restore-drill
```
