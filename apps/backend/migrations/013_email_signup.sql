-- Public sign-up with email confirmation and email password recovery. Existing accounts stay confirmed
-- (the column defaults to true); sign-up inserts false until the emailed link is used. Only a hash of each
-- emailed token is kept.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_account ON email_verifications(account_id);
ALTER TABLE account_recoveries ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS accounts_unverified ON accounts(created_at) WHERE NOT email_verified;
