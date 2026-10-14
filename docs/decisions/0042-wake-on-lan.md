# 0042: Wake-on-LAN through another computer on the same network

Status: accepted, 2026-10-14

## Context

An offline computer (asleep or off) cannot be reached by the server, and the server cannot send a wake packet into a home
or office network from the internet. A magic packet only works as a broadcast on the same local network.

## Decision

- **Only a neighbour can wake it.** Every computer reports, with its heartbeat, the hardware addresses of its connected wired and
  wireless cards (at most four) and a name for its local network: a 64-bit hash of the gateway address and the subnet, so two
  computers on one network agree on the name without the server learning any private address. The server also keeps a hash of
  the public address each heartbeat arrived from, and treats two computers as neighbours only when both the public-address
  hash and the network name match and both belong to the same account.
- **Waking is a request to a neighbour.** `POST /api/machines/:id/wake` (owner, same origin) is refused unless the target is
  offline, has reported hardware addresses, and another of the owner's non-temporary computers on the same network was seen in
  the last 45 seconds. It queues one request per hardware address for that neighbour (valid two minutes, delivered once) and
  records it in activity. The neighbour's agent receives it in its signed heartbeat response and broadcasts a magic packet
  (UDP 9 and 7) on its local network. There is no listener and no other traffic.
- **Honest limits.** It works only if the sleeping computer's network card is set to wake on a magic packet in its firmware and
  operating system, and wired Ethernet is far more reliable than Wi-Fi. With no neighbour awake on that network the button is not
  offered, because nothing the server could do would work. It is a convenience for the owner's own computers: it needs no
  approval from the neighbour's user (the packet carries nothing but a hardware address) and never starts a session; connecting
  still follows the usual consent.

## Not done

A dedicated always-on wake gateway device, wake from the public internet through a router port forward, waking computers of a
different account, and a local setting to turn the neighbour role off.
