-- A computer's own access policy (ADR 0021). Attended is the default and needs a local Allow
-- every time. Trusted is raised only by the computer itself and can be lowered from the web.
CREATE TABLE IF NOT EXISTS machine_access (
  machine_id uuid PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'attended' CHECK (mode IN ('attended','trusted')),
  allow_control boolean NOT NULL DEFAULT false CHECK (mode = 'trusted' OR NOT allow_control),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- How a session was approved. A policy session records the policy version it relied on, and it
-- ends within the renewal lease when that policy is lowered.
ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS approval text NOT NULL DEFAULT 'local'
  CHECK (approval IN ('local','policy'));
ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS policy_version integer;
