-- Boot service credentials have no interactive/session authority.
CREATE TABLE IF NOT EXISTS boot_agents (
  machine_id uuid PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
  public_key bytea NOT NULL UNIQUE CHECK (octet_length(public_key)=32),
  last_seen_at timestamptz,
  state text NOT NULL DEFAULT 'signed-out' CHECK (state IN ('signed-out','locked','starting'))
);
