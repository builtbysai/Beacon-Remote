-- Owner-authorized clean slate, not a migration or application endpoint.
-- Quiesce the selected Remote backend and verify encrypted backup recovery first.
-- Set beacon.account_reset_database to the exact independently inspected DB name
-- and beacon.account_reset_recovery to RESTORE_VERIFIED on this connection.
-- No role/schema/volume changes, TRUNCATE, path traversal or replacement accounts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $reset$
DECLARE
  expected text := current_setting('beacon.account_reset_database', true);
  known text[] := ARRAY[
    'accounts','browser_sessions','enrollments','machines','heartbeat_nonces',
    'audit_events','account_invitations','view_sessions','machine_access',
    'support_invitations','support_relationships','account_mfa','account_recoveries',
    'email_verifications','session_quality','team_members','support_links',
    'support_messages','wake_requests','machine_restarts','boot_agents',
    'signin_endpoints','signin_leases'
  ];
  present text[];
  item text;
  remaining bigint;
  removed bigint;
BEGIN
  IF expected IS NULL OR current_database() <> expected OR NOT (
    expected IN ('beacon_remote','beacon_remote_dev','beacon_remote_test',
      'beacon_remote_acceptance_20261010')
    OR expected ~ '^beacon_remote_reset_[0-9a-f]{32}_test$'
  ) THEN
    RAISE EXCEPTION 'Reset refused: explicit Beacon Remote database selection required';
  END IF;
  IF current_setting('beacon.account_reset_recovery', true) IS DISTINCT FROM 'RESTORE_VERIFIED' THEN
    RAISE EXCEPTION 'Reset refused: independently verified encrypted recovery required';
  END IF;
  -- A new table requires review of ownership and erasure semantics. Do not
  -- silently widen this operation as the schema evolves.
  SELECT array_agg(c.relname ORDER BY c.relname) INTO present
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','m','f');
  IF present IS NULL OR NOT present <@ known
    OR NOT ARRAY['accounts','machines','browser_sessions','enrollments',
      'audit_events','heartbeat_nonces','account_invitations']::text[] <@ present THEN
    RAISE EXCEPTION 'Reset refused: unexpected or incomplete Remote schema';
  END IF;
  -- Acquire all account-store locks in stable order before deleting anything.
  -- Lock timeout leaves the whole operation rolled back, rather than killing
  -- an unknown writer or applying only part of the reset.
  FOREACH item IN ARRAY present LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', item);
  END LOOP;
  IF EXISTS (
    SELECT FROM pg_constraint fk
      JOIN pg_class parent ON parent.oid=fk.confrelid
      JOIN pg_namespace pn ON pn.oid=parent.relnamespace
      JOIN pg_class child ON child.oid=fk.conrelid
      JOIN pg_namespace cn ON cn.oid=child.relnamespace
      WHERE fk.contype='f' AND pn.nspname='public' AND parent.relname=ANY(present)
        AND (cn.nspname <> 'public' OR NOT child.relname=ANY(present))
  ) OR EXISTS (
    SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(present) AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Reset refused: cross-scope dependencies or custom triggers need review';
  END IF;
  DELETE FROM public.account_invitations;
  DELETE FROM public.accounts;
  GET DIAGNOSTICS removed = ROW_COUNT;
  -- Every known account-data store must be empty, including orphan rows that
  -- would reveal a missing cascade. Any leftover rolls all deletions back.
  FOREACH item IN ARRAY present LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', item) INTO remaining;
    IF remaining <> 0 THEN
      RAISE EXCEPTION 'Reset refused: related data remained; transaction rolled back';
    END IF;
  END LOOP;
  RAISE NOTICE 'Remote accounts removed: %. All reviewed account stores are empty.', removed;
END
$reset$;
COMMIT;
