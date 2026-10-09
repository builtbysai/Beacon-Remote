# ADR 0003: Isolated control plane on the existing Oracle host

Use the existing free Oracle VM, whose tenancy limits and spare resources were
verified in Beacon View's capacity report. No OCI resources are provisioned.
Cloudflare DNS now resolves remote.builtbysai.com to the existing public address.

Remote receives a separate PostgreSQL container, volume, database, admin password
and non-administrative application role. Its backend and database stay on an
internal Docker network with no published ports. A private HTTP web container
joins only that network and a shared frontend `beacon-edge` network. Beacon View's
TLS Caddy imports a small hostname route to that frontend; neither application
joins the other's database network or receives its credentials.

Keep the existing View releases, media, TLS storage and rollback images intact.
Remote's steady-state memory limits total 1,152 MiB and CPU limits total 1.05 CPUs;
these are limits, not reservations or measurements. Bound Docker logs. Verify the
chosen private subnet does not overlap existing host/container networks.

The backend trusts only its explicit private proxy CIDR. The public TLS edge
normalizes forwarded client headers, and the private frontend passes that value
to the backend. Real login rate-limit integration protects against untrusted
forwarded-IP spoofing and ensures clients behind the trusted proxy have separate
budgets. Default local development still trusts no proxy.

Compile migration/operator scripts for the runtime image and copy their SQL
assets explicitly. Run migrations and independent schema/role verification before
the backend starts. Provision accounts through the operator command, never public
signup or copied Beacon View password hashes. General consumer access, desktop
media/input and code signing retain their separate release gates.

Before storing real account/device data, establish encrypted backup and isolated
restore verification. Local encrypted backups alone do not recover a lost VM;
off-host recovery remains a limitation until a verified free destination exists.
No production deployment or backup acceptance is claimed by these source files.

Sources: [Docker internal/external networks](https://docs.docker.com/reference/compose-file/networks/),
[Caddy imports](https://caddyserver.com/docs/caddyfile/directives/import).
