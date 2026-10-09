# Deployment gates

The control plane is currently local development; production deployment is not
claimed. Deploy to the existing Oracle host only after OCI free eligibility and
resource budgets are verified. Keep the host's existing Caddy/PostgreSQL/Coturn
services and Beacon View rollback releases intact.

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
