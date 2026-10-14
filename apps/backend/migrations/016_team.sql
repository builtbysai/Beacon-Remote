-- Teams (ADR 0037): an owner lets another account help with all of their computers, or one group of them, as a
-- viewer (view only) or a technician (view and control). Each computer still asks its own person, per its own
-- settings. Membership is kept as ordinary support relationships (ADR 0024), so consent, revocation and audit
-- behave exactly as for a single shared computer.
CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer','technician')),
  group_name text CHECK (group_name IS NULL OR char_length(group_name) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CHECK (owner_account_id <> member_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_active
  ON team_members(owner_account_id, member_account_id) WHERE removed_at IS NULL;
ALTER TABLE support_relationships
  ADD COLUMN IF NOT EXISTS team_member_id uuid REFERENCES team_members(id) ON DELETE CASCADE;
