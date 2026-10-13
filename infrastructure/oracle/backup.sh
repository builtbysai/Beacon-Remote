#!/bin/sh
set -eu
umask 077
: "${RESTIC_REPOSITORY:?required}" "${RESTIC_PASSWORD:?required}"
export RESTIC_CACHE_DIR=/tmp/restic-cache
target=beacon_remote_restore_check
created=false
workdir=
cleanup() {
  if [ "$created" = true ]; then
    PGPASSWORD="$REMOTE_ADMIN_PASSWORD" dropdb --host=postgres --username=remote_admin "$target"
    created=false
  fi
  if [ -n "$workdir" ]; then
    case "$workdir" in /tmp/beacon-remote-backup.*) rm -rf -- "$workdir";; esac
  fi
}
trap cleanup EXIT HUP INT TERM
case "${1:-run}" in
  init)
    restic init --quiet
    echo 'Independent encrypted Remote repository initialized.'
    ;;
  run)
    : "${REMOTE_DB_PASSWORD:?required}"
    workdir=$(mktemp -d /tmp/beacon-remote-backup.XXXXXXXX)
    PGPASSWORD="$REMOTE_DB_PASSWORD" pg_dump --host=postgres --username=remote_app \
      --dbname=beacon_remote --format=custom --no-owner --no-privileges --file="$workdir/postgres.dump"
    # Initial control-plane backups have a strict free-storage budget.
    bytes=$(wc -c < "$workdir/postgres.dump")
    [ "$bytes" -le 33554432 ] || { echo 'Dump exceeds the reviewed 32 MiB budget; backup refused.' >&2; exit 65; }
    # pg_dump completed successfully before restic sees its input.
    restic backup --stdin --stdin-filename postgres.dump --host beacon-remote-oracle --tag beacon-remote --quiet < "$workdir/postgres.dump"
    restic forget --host beacon-remote-oracle --tag beacon-remote --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune --quiet
    echo 'Encrypted Remote database backup passed.'
    ;;
  check)
    restic check --read-data --quiet
    echo 'Encrypted repository integrity verification passed.'
    ;;
  restore-check)
    [ "${REMOTE_ALLOW_ISOLATED_RESTORE:-}" = RESTORE_A_SEPARATE_DATABASE ] || { echo 'Explicit isolated restore marker required.' >&2; exit 64; }
    : "${REMOTE_ADMIN_PASSWORD:?required}" "${REMOTE_DB_PASSWORD:?required}"
    # A fixed verification name and refusal of ANY existing target protect live data.
    exists=$(PGPASSWORD="$REMOTE_ADMIN_PASSWORD" psql --host=postgres --username=remote_admin --dbname=postgres -Atc "SELECT EXISTS(SELECT FROM pg_database WHERE datname='$target')")
    [ "$exists" = f ] || { echo 'Restore target already exists; refused.' >&2; exit 65; }
    workdir=$(mktemp -d /tmp/beacon-remote-backup.XXXXXXXX)
    restic dump --host beacon-remote-oracle --tag beacon-remote latest /postgres.dump > "$workdir/postgres.dump"
    PGPASSWORD="$REMOTE_ADMIN_PASSWORD" createdb --host=postgres --username=remote_admin --owner=remote_app "$target"
    created=true
    PGPASSWORD="$REMOTE_DB_PASSWORD" pg_restore --host=postgres --username=remote_app --dbname="$target" --exit-on-error --no-owner --no-privileges "$workdir/postgres.dump"
    shape="SELECT string_agg(tablename,',' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"
    live=$(PGPASSWORD="$REMOTE_DB_PASSWORD" psql --host=postgres --username=remote_app --dbname=beacon_remote -Atc "$shape")
    restored=$(PGPASSWORD="$REMOTE_DB_PASSWORD" psql --host=postgres --username=remote_app --dbname="$target" -Atc "$shape")
    [ -n "$live" ] && [ "$live" = "$restored" ] || { echo 'Restored schema mismatch.' >&2; exit 65; }
    # Run while writes are quiesced; aggregate comparisons reveal no account contents.
    aggregate="SELECT (SELECT count(*) FROM accounts)::text||':'||(SELECT count(*) FROM machines)::text||':'||(SELECT count(*) FROM audit_events)::text"
    live=$(PGPASSWORD="$REMOTE_DB_PASSWORD" psql --host=postgres --username=remote_app --dbname=beacon_remote -Atc "$aggregate")
    restored=$(PGPASSWORD="$REMOTE_DB_PASSWORD" psql --host=postgres --username=remote_app --dbname="$target" -Atc "$aggregate")
    if [ "${REMOTE_RESTORE_SCHEMA_ONLY:-}" = 1 ]; then
      # The scheduled drill runs while the service is live, so counts legitimately differ from the backup (guest
      # accounts expire, sessions end). It proves the backup restores, the schema matches, and accounts survived.
      [ "$(PGPASSWORD="$REMOTE_DB_PASSWORD" psql --host=postgres --username=remote_app --dbname="$target" -Atc 'SELECT count(*)>0 FROM accounts')" = t ] \
        || { echo 'Restored database has no accounts.' >&2; exit 65; }
      echo 'Scheduled restore drill passed: the latest backup restores and matches the live schema; removing only its owned target.'
    else
      [ "$live" = "$restored" ] || { echo 'Restored aggregate mismatch; quiesce writes before validation.' >&2; exit 65; }
      echo 'Separate-database restore and schema/aggregate verification passed; removing only its owned target.'
    fi
    ;;
  *) echo 'Usage: remote-backup {init|run|check|restore-check}' >&2; exit 64;;
esac
