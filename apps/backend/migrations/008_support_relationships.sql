-- Remembered support relationships (ADR 0024): the owner lets one named account request sessions on
-- one computer until an expiry. Each session still needs the local Allow.
CREATE TABLE IF NOT EXISTS support_relationships (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  helper_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN ('desktop:view','desktop:control')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS support_relationships_active
  ON support_relationships(machine_id, helper_account_id) WHERE revoked_at IS NULL;
ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS relationship_id uuid;
