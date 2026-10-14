-- Wake-on-LAN (ADR 0042). A computer reports its network cards' hardware addresses and a name for the local network it
-- is on; to wake an offline one, another of the owner's computers on the same network sends the magic packet. The
-- server cannot reach into a home network itself.
ALTER TABLE machines ADD COLUMN IF NOT EXISTS macs text[];
ALTER TABLE machines ADD COLUMN IF NOT EXISTS lan_key text;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS public_ip_hash text;
CREATE TABLE IF NOT EXISTS wake_requests (
  id uuid PRIMARY KEY,
  target_machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  via_machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  mac text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS wake_requests_via ON wake_requests(via_machine_id) WHERE delivered_at IS NULL;
