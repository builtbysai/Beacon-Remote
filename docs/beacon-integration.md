# Beacon infrastructure integration

Beacon View currently uses cookie/bearer sessions, hashed device credentials,
PostgreSQL ownership checks, authenticated WebSocket signaling, audit repositories,
presence state, and expiring Coturn HMAC credentials. These are useful patterns;
its camera grants and database must not become desktop authorization.

Share the existing reverse proxy, PostgreSQL host and Coturn only through explicit
configuration. Remote requires its own database and database role, session cookie,
service network, configuration, and resource limits. Beacon View remains runnable
without Remote. Eventual common account identity should use validated federation
with a Remote audience and explicit consent/grants, not cross-app cookies or
access to camera account tables. TURN credentials can be issued only after a
Remote session is authorized; relay endpoint configuration must be replaceable.

No production database, proxy route, DNS record, or Coturn secret is changed by
the local foundation. See Beacon View's `docs/oracle-capacity.md` for current VM
capacity and the missing tenancy verification.
