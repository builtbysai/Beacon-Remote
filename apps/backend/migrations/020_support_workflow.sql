-- Support workflow (ADR 0040): chat with the person being helped, the technician's private notes, and the handoff
-- of a session to another technician. Chat belongs to the temporary computer and goes with it.
CREATE TABLE IF NOT EXISTS support_messages (
  id bigserial PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('technician','person','system')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_machine ON support_messages(machine_id, id);
ALTER TABLE support_links ADD COLUMN IF NOT EXISTS notes text CHECK (notes IS NULL OR char_length(notes) <= 4000);
