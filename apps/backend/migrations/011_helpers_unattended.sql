-- Remembered helpers without the local Allow (ADR 0027). Raised only by the computer's own signed
-- request; a helper session records the policy version it relied on and ends when it is lowered.
ALTER TABLE machine_access ADD COLUMN IF NOT EXISTS helpers_unattended text NOT NULL DEFAULT 'off'
  CHECK (helpers_unattended IN ('off','view','control'));
