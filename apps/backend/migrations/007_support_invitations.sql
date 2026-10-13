-- One-time attended support (ADR 0023). An invitation lets one signed-in helper request one
-- session on one computer, which the person at that computer still approves locally.
CREATE TABLE IF NOT EXISTS support_invitations (
  code_hash text PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN ('desktop:view','desktop:control')),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_invitations_machine ON support_invitations(machine_id);
