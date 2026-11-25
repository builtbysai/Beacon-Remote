-- A process lifetime marker detects fast restarts without treating stale presence as a reboot.
ALTER TABLE machines ADD COLUMN IF NOT EXISTS host_instance_id uuid;
