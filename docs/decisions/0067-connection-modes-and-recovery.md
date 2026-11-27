# 0067: Connection modes, wake, sleep and update recovery

Status: proposed November 27, 2026. Design only: nothing here is built, and no network behaviour is claimed beyond what the
code already does. It covers the "direct, relay, IPv6, proxy and offline-LAN modes; Wake-on-LAN, sleep and update recovery"
part of roadmap M8. It builds on the neighbour-assisted wake of [0042](0042-wake-on-lan.md), the signed host updates of
[0028](0028-signed-host-updates.md) and the peer authentication of
[0061](0061-peer-authentication-above-signaling.md).

## What exists today

The backend issues short-lived TURN credentials from a shared secret and may set the ICE policy to `all` (direct paths first,
then the relay) or `relay` (relay only), and it trusts forwarded client addresses only from one configured private proxy
range. A computer that is asleep can be woken by another computer of the same account on its network (neighbour-assisted
wake), which is a hardware and network workflow, not a guarantee. Hosts report presence by heartbeat, and updates are signed.

## The rule everything else must keep

**A mode changes only the path, never the permission.** Whatever route a connection takes, the same local consent, short
leases, peer authentication and revocation apply, and media never passes through the Beacon server except as encrypted
relay traffic it cannot read.

## Decisions proposed

1. **Direct and relay stay the two real choices, made per account by one setting.** `all` is the default; `relay` is for
   people who must not expose their address. The person sees which path a session used.
2. **IPv6 is a property of the relay and of the candidates, not a separate mode.** The TURN service listens on IPv6 as well
   as IPv4 and the hosts offer IPv6 candidates; dual-stack is tested with the two address families forced in turn. Nothing
   is announced as IPv6-ready until a real IPv6-only network has connected.
3. **Proxy mode means getting out through a corporate proxy.** Signalling already uses HTTPS and WebSocket, so it follows the
   system proxy settings through an ordinary CONNECT. For media, the relay is offered over TCP on port 443 with TLS so a
   firewall that only allows web traffic can still pass it. A proxy that breaks TLS inspection is reported as an error, never
   trusted around.
4. **Offline-LAN mode is narrower on purpose.** For two computers already paired and already holding each other's pinned keys
   (0061) on one network with no internet, the host may accept a connection directly on the LAN, announced by a local discovery
   message. Consent is local as always, and unattended access is allowed only if the computer's own cached policy already
   permits it. It never enrolls a new computer, never changes a policy, and refuses when the pinned key does not match.
5. **Wake keeps the neighbour-assisted design and says honestly when it cannot work.** A computer that has never seen a
   neighbour, or whose network card and firmware are not set to wake, reports "cannot be woken from here" rather than
   pretending. An always-on gateway is the proposed answer for networks with no neighbour, as an opt-in and not a requirement.
6. **Sleep is a presence state, not a failure.** A missing heartbeat while the computer was last seen going to sleep shows as
   "asleep" with the wake option; only an unexplained gap shows as "offline".
7. **Update recovery never strands a computer.** Already true today ([0028](0028-signed-host-updates.md)): an update is
   verified against the pinned key and the old files are kept in `previous` and can be restored with a rollback command. What
   this proposes in addition: an update is applied only when no session is live, the new version must report healthy within a
   set time or the previous one is put back automatically, and a version below the minimum the server requires is refused.

## Not decided here

Whether offline-LAN mode ships at all (it adds a listening surface the other modes do not have), the exact discovery
mechanism, and which proxy authentication schemes to support.

## Checks that would settle it

- Mode-selection tests that force each address family and each policy, and assert that the permission checks behave
  identically on every path.
- Network-namespace or traffic-shaping runs for relay-only, TCP-443 and IPv6-only paths, recorded on real networks before any
  claim.
- For offline-LAN: a test that a mismatched pinned key, an unpaired peer and a stale cached policy are each refused, and that
  the listening port is closed unless the mode is on.
- For updates: an interrupted update, a version that never becomes healthy, and a rollback, each ending with a working host.
