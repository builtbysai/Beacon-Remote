CREATE TABLE IF NOT EXISTS view_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('desktop','synthetic')),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','connecting','active','ended','denied')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS view_sessions_one_live_machine
ON view_sessions(machine_id) WHERE status IN ('requested','connecting','active');
