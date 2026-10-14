# Running Beacon Remote on your own server

One server, Docker Compose, no source changes. You bring a domain name and a Linux server with a public IP. Nothing in
this folder refers to anyone else's domain, server or secrets.

## What you get

PostgreSQL, the backend, the website with its own automatic HTTPS certificate (Caddy), and a TURN relay (Coturn) for when two
computers cannot reach each other directly. The database and backend sit on a private network with no way out except
sending email, and only the website and the relay face the internet.

## Before you start

- A server with Docker and the Compose plugin, `git` and `openssl`. Linux x86-64 or arm64.
- A domain name you control, pointing at the server's public IPv4 address (an `A` record).
- Open: TCP 80 and 443 (website and certificate), UDP 443 (HTTP/3, optional), UDP 3478 and UDP 49160 to 49200 (relay).
- Resources: 1 vCPU and 2 GB of RAM is enough for a household or a small team (a few computers and a couple of simultaneous
  sessions). Video flows directly between computers when it can; the relay carries it only when it cannot, at up to 4 Mbit/s
  per session, so give the relay's network a few Mbit/s per relayed session. Disk: a few GB, growing slowly with history.

## Set up

```bash
git clone https://github.com/builtbysai/Beacon-Remote.git
cd Beacon-Remote/deploy/self-hosted
./beaconctl setup remote.example.com 203.0.113.10   # your domain and the server's public IP
./beaconctl up
./beaconctl first-admin
```

`setup` generates every secret on this server (database passwords, the session secret, the relay secret), writes them to
`.env` and `secrets/` with permissions that keep other users out, and refuses to overwrite an existing `.env`. It prints
the DNS and firewall steps. `up` builds and starts everything; the website answers once the certificate has been issued,
usually within a minute.

`first-admin` prints a one-use link that expires in 30 minutes. Open it, choose a password of at least 16 characters, and
that account is yours. Sign-up is closed afterwards: more people join only by invitation (`./beaconctl first-admin` prints a
new link) or, if you configure email, by public sign-up (below).

## Pointing computers at your server

The website you just set up is the one the Windows host pairs with: in the Beacon Remote window enter your server address
(`https://remote.example.com`) when pairing, and the host remembers it. The temporary-support program and the installer
carry a default server baked in at build time. To publish builds that default to yours, build with
`BEACON_DEFAULT_SERVER=https://remote.example.com` set (see `docs/deployment.md`) and put the files in `deploy/self-hosted/downloads/`
with the manifest that `scripts/publish-download.mjs` writes; the Downloads page serves them. The official builds default to
the hosted service, so a self-hosted server needs its own build (`BEACON_DEFAULT_SERVER`).

## Email (optional)

Without email, accounts are invitation-only and password recovery is by an operator link. To enable public sign-up and
email recovery, set `RESEND_API_KEY`, `MAIL_FROM` and `PUBLIC_SIGNUP=true` in `.env`, then `./beaconctl up` again. Any other
mail provider needs a code change; none is built in.

## Backups, restore, updates

```bash
./beaconctl backup              # ./backups/beacon-<time>.dump, the 14 newest kept
./beaconctl restore backups/beacon-20261014T120000Z.dump
./beaconctl update              # backup, git pull, rebuild, wait until healthy
./beaconctl rollback            # previous backend build
```

Keep backups somewhere else too (copy `./backups` off the server on a schedule). Updates are forward-only for the database:
if a new version changed the schema and you need to go back, run `rollback` and then `restore` the backup `update` made just
before. `./beaconctl status` shows what is running and checks the database schema.

## Health

Compose health checks watch the database and backend; `https://your-domain/ready` answers 200 when the app and database are
reachable. `./beaconctl logs [service]` follows logs; they are size-limited and rotated by Docker.

## Secrets

`.env` holds the secrets and `secrets/turnserver.conf` the relay's; both are created with `umask 077` and ignored by git. They
are the only copy: back them up with the database, and never share them. Rotating the session or relay secret ends active
sessions; delete `.env` yourself and run `setup` again only if you mean to start over (a new database password also needs the
database volume recreated).
