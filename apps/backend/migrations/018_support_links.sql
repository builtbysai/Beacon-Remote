-- One-click temporary support (ADR 0038). A technician creates a short-lived link; the support client the
-- recipient runs redeems it once and becomes a temporary computer in the technician's list. Ending support,
-- or its time limit, revokes that computer, so no access relationship outlives the session.
CREATE TABLE IF NOT EXISTS support_links (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  capability text NOT NULL CHECK (capability IN ('desktop:view','desktop:control')),
  label text CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  ended_at timestamptz,
  ended_by text CHECK (ended_by IN ('technician','recipient','expired'))
);
CREATE INDEX IF NOT EXISTS support_links_account ON support_links(account_id, created_at DESC);
ALTER TABLE machines ADD COLUMN IF NOT EXISTS support_link_id uuid REFERENCES support_links(id) ON DELETE CASCADE;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS temporary_until timestamptz;
CREATE INDEX IF NOT EXISTS machines_support_link ON machines(support_link_id) WHERE support_link_id IS NOT NULL;
