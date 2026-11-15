-- A third identity, independent from the ordinary user and boot-presence keys.
-- This registry does not enable media or mark a computer interactively online.
CREATE TABLE IF NOT EXISTS signin_endpoints (
  machine_id uuid PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
  public_key bytea NOT NULL UNIQUE CHECK (octet_length(public_key)=32),
  enabled boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  instance_id uuid,
  console_session_id bigint CHECK (console_session_id BETWEEN 1 AND 4294967294),
  state text NOT NULL DEFAULT 'unavailable' CHECK (state IN ('unavailable','sign-in','signed-in')),
  worker_ready boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  CHECK (NOT worker_ready OR state='sign-in')
);
CREATE TABLE IF NOT EXISTS signin_leases (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  browser_token_hash text NOT NULL REFERENCES browser_sessions(token_hash) ON DELETE CASCADE,
  endpoint_version bigint NOT NULL CHECK (endpoint_version>0),
  policy_version bigint NOT NULL CHECK (policy_version>0),
  instance_id uuid NOT NULL,
  console_session_id bigint NOT NULL CHECK (console_session_id BETWEEN 1 AND 4294967294),
  expires_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at<=deadline)
);
CREATE UNIQUE INDEX IF NOT EXISTS signin_one_controller
  ON signin_leases(machine_id) WHERE ended_at IS NULL;
