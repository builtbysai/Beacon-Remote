-- Who did it, when it was not the account the row belongs to: a helper or team member's connection to a computer is
-- recorded in the owner's activity with the helper as the actor. Cleared if the helper's account is deleted.
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

-- A computer's history goes with the computer. Without this an owner could not delete their account once a helper
-- had connected to one of their computers, because the helper's own rows still pointed at it.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_machine_id_fkey;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE;
