-- NULL represents explicitly enabled, loopback-only development sessions.
-- Authorization renewal, approval expiry and termination remain separate.
ALTER TABLE view_sessions ALTER COLUMN expires_at DROP NOT NULL;
