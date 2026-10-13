-- The displays a computer reports, and the one a desktop session was requested for.
ALTER TABLE machines ADD COLUMN IF NOT EXISTS displays jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS display_id text;
