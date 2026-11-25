-- An ephemeral worker public key is separately attested by the machine key.
-- Legacy heartbeats never supply a worker transport credential.
ALTER TABLE signin_endpoints ADD COLUMN IF NOT EXISTS worker_public_key bytea;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='signin_endpoints'::regclass AND conname='signin_worker_key_length') THEN
    ALTER TABLE signin_endpoints ADD CONSTRAINT signin_worker_key_length
      CHECK (worker_public_key IS NULL OR octet_length(worker_public_key)=32);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS signin_worker_key_unique ON signin_endpoints(worker_public_key)
  WHERE worker_public_key IS NOT NULL;
