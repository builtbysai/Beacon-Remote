-- A terminal sign-in transition is browser-bound and never renews SYSTEM
-- authority. Its short window permits only a fresh ordinary policy grant.
ALTER TABLE signin_leases ADD COLUMN IF NOT EXISTS ended_reason text
  CHECK (ended_reason IN ('transport','stopped','invalidated','interrupted','handoff','expired'));
ALTER TABLE signin_leases ADD COLUMN IF NOT EXISTS handoff_expires_at timestamptz;
ALTER TABLE signin_leases ADD COLUMN IF NOT EXISTS handoff_session_id uuid
  REFERENCES view_sessions(id) ON DELETE SET NULL;
ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS handoff_browser_token_hash text
  REFERENCES browser_sessions(token_hash) ON DELETE CASCADE;
