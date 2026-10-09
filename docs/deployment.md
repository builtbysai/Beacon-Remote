# Deployment gates

The control plane is currently local development; production deployment is not
claimed. Deploy to the existing Oracle host only after OCI free eligibility and
resource budgets are verified. Keep the host's existing Caddy/PostgreSQL/Coturn
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

Apply migrations explicitly and verify schema, establish encrypted backups and
an isolated restore drill, then deploy a validated exact commit. Verify HTTPS,
database readiness, login, pairing, signed presence, revocation, restart and
Beacon View health independently. Do not reuse local test passwords. General
consumer access additionally requires the account lifecycle/security gates in
`security.md`. Never expose an unfinished input/capture endpoint.
