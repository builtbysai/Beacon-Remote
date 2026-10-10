#!/bin/sh
set -eu

# Coturn maps external peer addresses back to relay-ip. Mapping to a wildcard
# makes same-server relay peers fail the protected zero-address check.
# Resolve the container address on every start, rather than pinning a Docker IP.
relay_ip=$(hostname -i)
case "$relay_ip" in
  ""|0.*|127.*|*:*|*[!0-9.]*)
    echo 'TURN startup requires one concrete container IPv4 address' >&2
    exit 1
    ;;
esac

exec turnserver "$@" "--relay-ip=$relay_ip"
