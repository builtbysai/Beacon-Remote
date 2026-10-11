#!/bin/sh
set -eu
umask 077

# Fail before opening a listener if the dedicated secret is missing/malformed.
# Its file contains exactly one static-auth-secret line, not shell code.
secret_file=/run/secrets/remote-turn.conf
if ! [ "$(wc -l < "$secret_file")" -eq 1 ] ||
   ! grep -Eq '^static-auth-secret=[a-f0-9]{64}$' "$secret_file"; then
  echo 'Remote TURN requires a dedicated 256-bit secret configuration' >&2
  exit 1
fi
relay_ip=$(hostname -i)
case "$relay_ip" in
  ""|0.*|127.*|*:*|*[!0-9.]*)
    echo 'Remote TURN requires one concrete container IPv4 address' >&2
    exit 1
    ;;
esac
case "${REMOTE_TURN_PUBLIC_IP:-}" in
  ""|0.*|127.*|*:*|*[!0-9.]*)
    echo 'Remote TURN requires a public IPv4 mapping' >&2
    exit 1
    ;;
esac

# Keep the authentication secret out of argv, environment and rendered Compose.
cat /etc/remote-turn/turnserver.conf "$secret_file" > /run/remote-turn/turnserver.conf
exec turnserver -c /run/remote-turn/turnserver.conf \
  "--external-ip=$REMOTE_TURN_PUBLIC_IP" "--relay-ip=$relay_ip"
