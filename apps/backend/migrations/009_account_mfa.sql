-- Two-step sign-in (ADR 0025). The secret is stored encrypted; recovery codes are stored hashed.
CREATE TABLE IF NOT EXISTS account_mfa (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  secret bytea NOT NULL,
  enabled_at timestamptz,
  last_step bigint,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  recovery text[] NOT NULL DEFAULT '{}'
);
