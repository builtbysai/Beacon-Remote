-- Signed ordinary-host console identity is independent of the privileged
-- sign-in worker. Legacy heartbeats clear it rather than retaining stale state.
ALTER TABLE machines ADD COLUMN IF NOT EXISTS host_console_session_id bigint
  CHECK (host_console_session_id BETWEEN 1 AND 4294967294);

-- A handoff requests a fresh ordinary grant pinned to this host process/console.
-- Existing ordinary grants remain unpinned; this never raises local policy.
ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS host_instance_id uuid;
ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS host_console_session_id bigint
  CHECK (host_console_session_id BETWEEN 1 AND 4294967294)
  CHECK ((host_instance_id IS NULL) = (host_console_session_id IS NULL));
