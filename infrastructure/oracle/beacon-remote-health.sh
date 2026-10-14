#!/bin/bash
# Beacon Remote health check: run every five minutes by beacon-remote-health.timer.
#
# Checks the site, the four containers, disk space, the TLS certificate, the last database backup and relay quota
# pressure. A problem is mailed after it has failed twice in a row (so a deploy restart is not an alert), again every
# six hours while it lasts, and once when it clears. Mail goes through the same Resend key the backend uses
# (RESEND_API_KEY, MAIL_FROM in production-media.env) to the address in /etc/beacon-remote/alert-to.
#
#   HEALTH_DRY_RUN=1          print results and what would be mailed; send nothing, keep no state
#   HEALTH_FORCE_FAIL=<name>  report that check as failing (to test the mail path end to end)
set -u
ENV_FILE=/etc/beacon-remote/production-media.env
TO_FILE=/etc/beacon-remote/alert-to
STATE_DIR=/var/lib/beacon-remote-health
SITE=remote.builtbysai.com
REPEAT_SECONDS=21600
DISK_LIMIT=85
CERT_DAYS=14
BACKUP_HOURS=36
DRY=${HEALTH_DRY_RUN:-0}
FORCE=${HEALTH_FORCE_FAIL:-}

declare -A problem   # name -> message, only for failing checks
declare -a names

check() { # name, message if failing, command...
  local name=$1 message=$2
  shift 2
  names+=("$name")
  if [ "$FORCE" = "$name" ] || ! "$@" >/dev/null 2>&1; then problem[$name]=$message; fi
}

container_ok() {
  local state
  state=$(docker inspect -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$1" 2>/dev/null) || return 1
  [ "$state" = "true healthy" ] || [ "$state" = "true " ]
}
disk_ok() { [ "$(df --output=pcent / | tail -1 | tr -dc '0-9')" -lt "$DISK_LIMIT" ]; }
cert_ok() {
  echo | openssl s_client -connect 127.0.0.1:443 -servername "$SITE" 2>/dev/null | openssl x509 -noout -checkend $((CERT_DAYS * 86400))
}
backup_ok() {
  local result exited
  result=$(systemctl show beacon-remote-backup.service -p Result --value)
  exited=$(systemctl show beacon-remote-backup.service -p ExecMainExitTimestamp --value)
  [ "$result" = "success" ] && [ -n "$exited" ] && [ $(($(date +%s) - $(date -d "$exited" +%s))) -lt $((BACKUP_HOURS * 3600)) ]
}
relay_ok() { ! docker logs --since 6m beacon-remote-turn-coturn-1 2>&1 | grep -qi "quota reached"; }

check site "The site is not answering ready on https://$SITE/ready" curl -fsS -m 10 --resolve "$SITE:443:127.0.0.1" "https://$SITE/ready"
check backend "The backend container is not running and healthy" container_ok beacon-remote-backend-1
check web "The web container is not running" container_ok beacon-remote-web-1
check database "The database container is not running and healthy" container_ok beacon-remote-postgres-1
check relay-container "The relay (coturn) container is not running" container_ok beacon-remote-turn-coturn-1
check relay-quota "The relay is refusing connections because its quota is full" relay_ok
check disk "The disk is at least ${DISK_LIMIT}% full" disk_ok
check certificate "The TLS certificate for $SITE expires within $CERT_DAYS days or cannot be read" cert_ok
check backup "The last database backup failed or is older than $BACKUP_HOURS hours" backup_ok

if [ "$DRY" = 1 ]; then
  for name in "${names[@]}"; do
    if [ -n "${problem[$name]:-}" ]; then echo "FAIL $name: ${problem[$name]}"; else echo "ok   $name"; fi
  done
  exit 0
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
now=$(date +%s)

send() { # subject, body
  local key from to subject body
  key=$(sed -n 's/^RESEND_API_KEY=//p' "$ENV_FILE" | head -1)
  from=$(sed -n 's/^MAIL_FROM=//p' "$ENV_FILE" | head -1)
  to=$(head -1 "$TO_FILE" 2>/dev/null | tr -d '\r\n ')
  [ -n "$key" ] && [ -n "$from" ] && [ -n "$to" ] || { echo "mail not configured; would send: $1"; return 1; }
  subject=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  body=$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s\\n", $0}')
  curl -fsS -m 20 https://api.resend.com/emails -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
    -d "{\"from\":\"$from\",\"to\":[\"$to\"],\"subject\":\"$subject\",\"text\":\"$body\"}" >/dev/null
}

for name in "${names[@]}"; do
  file="$STATE_DIR/$name"
  failures=0
  alerted=0
  [ -f "$file" ] && read -r failures alerted <"$file"
  if [ -n "${problem[$name]:-}" ]; then
    failures=$((failures + 1))
    if [ "$failures" -ge 2 ] && [ $((now - alerted)) -ge "$REPEAT_SECONDS" ]; then
      if send "Beacon Remote: $name needs attention" "${problem[$name]}

Checked $(date -u '+%Y-%m-%d %H:%M UTC') on $(hostname). This repeats every 6 hours until it clears, and you get one mail when it does."; then alerted=$now; fi
    fi
    echo "$failures $alerted" >"$file"
  else
    if [ "$failures" -ge 2 ] && [ "$alerted" -gt 0 ]; then
      send "Beacon Remote: $name is back to normal" "The $name check passes again as of $(date -u '+%Y-%m-%d %H:%M UTC')." || true
    fi
    rm -f "$file"
  fi
done
