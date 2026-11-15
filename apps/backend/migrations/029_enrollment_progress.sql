-- Additive: existing hosts and the first four enrollment columns stay compatible.
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS machine_id uuid
  REFERENCES machines(id) ON DELETE SET NULL;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
