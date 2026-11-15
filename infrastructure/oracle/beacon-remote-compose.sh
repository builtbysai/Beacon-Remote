#!/bin/sh
# Operations must use the same reviewed images and private configuration as the
# running release. Refuse a missing/ambiguous release instead of using old tags.
set -eu
release=$(readlink -f /opt/beacon-remote/current)
revision=$(basename "$release")
case "$release" in /opt/beacon-remote/releases/*) ;; *) exit 64;; esac
case "$revision" in ''|*[!0-9a-f]*) exit 64;; esac
[ "${#revision}" -eq 40 ]
[ "$(cat "$release/SOURCE_REVISION")" = "$revision" ]
[ -f "$release/compose.release-images.json" ]
exec /usr/bin/docker compose --project-name beacon-remote --profile operations \
  --env-file /etc/beacon-remote/production.env \
  -f "$release/infrastructure/oracle/compose.yaml" \
  -f /etc/beacon-remote/production-media.override.yaml \
  -f /etc/beacon-remote/runtime-data-services-image.override.yaml \
  -f "$release/compose.release-images.json" "$@"
