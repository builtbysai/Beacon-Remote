-- Remote restart (ADR 0043): an instruction for a trusted computer's own agent, delivered once through its signed
-- heartbeat. The computer restarts itself with a visible countdown that its user can cancel.
CREATE TABLE IF NOT EXISTS machine_restarts (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS machine_restarts_pending ON machine_restarts(machine_id) WHERE delivered_at IS NULL;
