# Remote-owned TURN deployment

This standalone Compose project is not yet the active Remote relay. Deploy only
after the ingress checks and acceptance gates in
[the migration runbook](../../../docs/relay-separation.md). It never operates
View's Compose project. Listener: TCP/UDP 3479; UDP relays: 49201–49240.
TCP client connections still request UDP relays; RFC 6062 TCP peer relays and
TLS/DTLS listeners are disabled. Desktop media uses WebRTC transport encryption.

Deploy immutable copies of these files into a root-owned release directory.
The secret mount is a **file** containing exactly one LF-terminated line:
`static-auth-secret=` followed by 64 lowercase hexadecimal characters. Generate
it on the server, never in Git, Compose environment, argv or deployment logs.
Use a root-owned `0700` parent directory, then give only the mounted secret file
UID/GID `65534:65534` and mode `0400`. The image's non-root user can read the
mounted file; host users cannot traverse the protected parent. The generated
runtime config lives in a private non-root-owned tmpfs. The upstream binary's
file capability requires `NET_BIND_SERVICE` in the bounding set; all other
capabilities are dropped and `no-new-privileges` stays enabled.

Set the non-secret `REMOTE_TURN_PUBLIC_IP` and absolute
`REMOTE_TURN_SECRET_FILE` paths in an operator environment file. Do not reuse
View's REST secret. Use this exact standalone Compose file:

```sh
sudo docker compose --project-name beacon-remote-turn \
  --env-file /etc/beacon-remote/turn/operator.env \
  -f /etc/beacon-remote/turn/releases/<revision>/compose.yaml config --quiet
```

Starting it is a separate deployment step. Do not use `down` on View or on the
Remote application project. The named state volume and relay bridge belong
only to `beacon-remote-turn`; no application/database network is attached.

Coturn's explicit `public/private` mapping automatically permits its exact
container relay IP. This is an intentional exception for communication between
allocations using the same public relay. Every other private peer remains
subject to the denied baseline. Do not attach another workload to this bridge
or join the relay to an application network. The exception permits targeting
this Coturn container, so private-peer rejection must not be described as
unconditional. Test the actual public relay IP as well as forbidden app/host
addresses before cutover.

The configuration bounds memory to 128 MiB, CPU to 0.25, per-user allocations to
4, total allocations to 20, per-session bandwidth to 4,000,000 bytes/s and server
capacity to 16,000,000 bytes/s. Capacity reservation may reject allocations
before the total allocation quota is reached. These are private-alpha limits,
not a throughput benchmark or a jointly approved VM budget. Validate that actual
browser/helper ICE gathering fits this budget before cutover.

The IPv4-only protocol probe accepts protected own/foreign secret files:

```sh
sudo python3 scripts/check-turn-policy.py --host 127.0.0.1 --port 3479 \
  --public-peer 129.213.128.206 \
  --secret-file /etc/beacon-remote/turn/secret/remote.conf \
  --foreign-secret-file <protected-foreign-secret-fixture>
```

The probe never sends data to the public permission target. It proves allocation,
IPv4 permissions, foreign-secret rejection, combined admission limits and
recovery after lifetime-zero release. It does not prove IPv6 permissions, each
quota independently, bandwidth throughput, public ingress or live playback.
Use generated unrelated test secrets for local fixtures; use securely extracted
real product secrets for deployment isolation tests, without printing them.
