-- Accountless guest support: a helper who redeems a one-time support code without an account gets a temporary,
-- passwordless guest account that can only run support sessions and is deleted when it expires.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS guest_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS accounts_guest_expiry ON accounts(guest_expires_at) WHERE guest_expires_at IS NOT NULL;
