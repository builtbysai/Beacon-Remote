-- Measured connection quality, sampled by the viewer while a session runs: what the owner needs to judge a
-- real device and network without guessing. A few numbers per sample; no media, no content.
CREATE TABLE IF NOT EXISTS session_quality (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES view_sessions(id) ON DELETE CASCADE,
  sampled_at timestamptz NOT NULL DEFAULT now(),
  route text NOT NULL CHECK (route IN ('Direct','Relayed','Unavailable')),
  height integer,
  fps real,
  rtt_ms real,
  loss_pct real
);
CREATE INDEX IF NOT EXISTS session_quality_session ON session_quality(session_id, sampled_at);
