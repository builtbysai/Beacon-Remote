-- Operator-issued one-time password recovery links (ADR 0026). Only a hash of the token is kept.
CREATE TABLE IF NOT EXISTS account_recoveries (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz
);
