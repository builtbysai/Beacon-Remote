ALTER TABLE view_sessions ADD COLUMN IF NOT EXISTS capability text NOT NULL DEFAULT 'desktop:view'
  CHECK (capability IN ('desktop:view','desktop:control'));
-- Control always includes a visible desktop; synthetic grants cannot inject input.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='view_sessions_control_source' AND conrelid='view_sessions'::regclass) THEN
    ALTER TABLE view_sessions ADD CONSTRAINT view_sessions_control_source
      CHECK (capability <> 'desktop:control' OR source = 'desktop');
  END IF;
END $$;
