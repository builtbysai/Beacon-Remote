# Deployment gates

November 24 (web only, owner approved): `c095bd54c48f185e92cdb11b46b27be6a79f3ddb` is the current Remote production
release: the redesigned web frontend (new design system, tabbed inspector, card lists, pairing panel). Only the web
container changed; the backend stays on the unchanged `975fc76` image (re-tagged). Encrypted backup first (service
succeeded), rollback tag `rollback-dc42802`, health, readiness and served assets checked.

November 22 (second web-only rollout, owner approved): `dc42802f1fbfd7aa40721df307f51fb869a25299` is the current Remote
production release: the viewer's instant local press ripple. Only the web container changed (backend stays on the
`975fc76` image, re-tagged); backup first, rollback tag `rollback-38251937`. Production's ICE transport policy was
checked and is already `all` (direct first, relay as fallback), so no configuration change was needed.

November 22 (web only, owner approved): `38251937c72b4ae12c9924e6e316b3bd26538346` is the current Remote production release:
the viewer's performance diagnostics (control round trip, jitter buffer, decode time) and the unknown-message
tolerance. Only the web container changed; the backend stays on the unchanged `975fc76` image (re-tagged to this
release). Encrypted backup first, rollback tag `rollback-57e57bb`, health and served assets checked. The test stack's
web is on the same build. The phone build (`7fe90e68`, one merged "Connect without asking" setting) is installed on the
Pixel only.

November 21 (fourth rollout, web only): `5da796f0142c77e68f9515c6308b78d6d09d7ef8` is the current Remote production release:
the computers page and inspector are back to their original look, the viewer keeps its rebuilt layout, and Unlock is
offered only at the lock screen. Only the web container changed; the backend stays on the unchanged `975fc76` image
(re-tagged to this release). Encrypted backup first, rollback tag `rollback-4061636`, health and served assets checked.

November 21 (third rollout of the day, web only): `4061636fafefb04077a30223cafe1925affb6feb` is the current Remote production
release. Only the web container changed (the rebuilt viewer and computers page); the backend image is the unchanged
`975fc76` build, re-tagged to this release so the operations wrapper finds it, and keeps running. Encrypted backup
first, rollback tag `rollback-975fc76`, public health and the served assets checked.

November 21 (second rollout of the day): `975fc76fab3bd19541b7cc2f9a55f23bea6ea9db` replaced `104e005` as the current Remote
production release (new phone-made pairing routes, viewer and workspace redesign, no schema change), with an encrypted
backup first, rollback tags `rollback-104e005`, migrate and schema/role verify passed, both containers healthy, and the
public health, readiness, served assets and the new `/api/device-pairing/start` route checked.

November 21 manual rollout (owner-authorized, "wipe the database and rollout the new"): `104e005a8cb5038b1ebb28b1f321cb678e2803c6`
is the current Remote production release, after an encrypted backup (passed), rollback tags `rollback-5e8d5c5` for
the predecessor `5e8d5c5`, the predecessor backend stopped, migrate and schema/role verify passed (no schema change
needed), backend and web recreated, and public health, readiness and the served web assets checked. The owner asked for
the database to be cleared; every table that holds accounts, computers, sessions, enrollments, audit events and support
data was already empty (0 rows) before the rollout, so nothing was deleted. Rollback is the documented one: retag
`rollback-5e8d5c5`, `up -d --no-deps backend web` without `--build`, repoint `current`. Beacon View's containers were
not touched.

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

## Release order for the November 2026 candidates

Source only; nothing here has been deployed. Roll out in this order and stop at the first failed check:

1. Back up and test a restore, then apply migrations 023-029 ([migrations](../apps/backend/migrations)) and verify the schema.
2. Deploy the backend and web build first. The backend accepts the optional `peer` proof beside a host's offer and lists
   each computer's public identity key; both are ignored by older hosts and viewers, so this step is safe on its own.
3. Then ship signed host builds (Windows installer, Android). A host that signs before the backend is updated would have
   its offers rejected for the unknown `peer` field.
   3a. A Windows host now offers a `ui_tree` permission, and a viewer that does not know that scope rejects the whole
   permission-options message (and with it the other live requests). Deploy the web build and protocol with step 2,
   before any host built from this commit is installed.
4. Strict identity stays a per-browser opt-in until every computer a person uses has an updated host.
5. Rollback is the previous image set; the new migrations are additive. Hosts keep working unsigned.

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

November 15, 2026: production operations use the guarded
`/usr/local/sbin/beacon-remote-compose` wrapper from
`infrastructure/oracle/beacon-remote-compose.sh`. Install it root-owned mode 0750
with the matching backup/restore units before enabling their timers. It selects
the current release's exact image override after private media/data-service
overrides, so a new source symlink cannot silently run an older operations image.
The release must contain a matching `SOURCE_REVISION` and generated
`compose.release-images.json`. Capture a new backup after migrations, then run
the scheduled restore drill: a pre-migration backup intentionally fails a schema
comparison with the newly migrated live database. Both updated jobs passed on
November 15. Empty account tables are valid after the requested reset.

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

## Health alerts

`beacon-remote-health.timer` runs `infrastructure/oracle/beacon-remote-health.sh` every five minutes. It checks the
site's `/ready`, the backend, web, database and relay containers, disk space (85%), the TLS certificate (14 days),
the last database backup (36 hours) and relay quota pressure (coturn refusing allocations). A problem is mailed after
two failures in a row, again every six hours while it lasts, and once when it clears. Mail uses the backend's Resend
key and sender from `production-media.env` and goes to the address in `/etc/beacon-remote/alert-to` (mode 0600, one
line). Install once:

```
echo owner@example.com | sudo tee /etc/beacon-remote/alert-to && sudo chmod 600 /etc/beacon-remote/alert-to
sudo cp infrastructure/oracle/beacon-remote-health.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now beacon-remote-health.timer
sudo HEALTH_DRY_RUN=1 bash infrastructure/oracle/beacon-remote-health.sh   # print every check, send nothing
sudo HEALTH_FORCE_FAIL=disk bash infrastructure/oracle/beacon-remote-health.sh   # run twice to test the mail path
```

It watches Beacon Remote only; Beacon View has its own monitor. It cannot report that the whole server is down.

The current local source formats alerts as HTML plus the full original plain
text using the adjacent `render-alert.py` (Python 3 standard library). Keep that
file with the health script in the matching checkout during release. Its renderer
has no credentials/network access; the existing shell sender owns the provider
call. This change has not been installed on the server. Local preview/unit checks
do not prove live alert delivery; retain the explicit deployment acceptance step.
