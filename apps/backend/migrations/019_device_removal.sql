-- Remote removal (ADR 0039). Asking to uninstall revokes the computer at once and keeps one instruction, valid for
-- 30 days, that the computer's own signed heartbeat receives if it reconnects. It confirms when it has removed itself.
ALTER TABLE machines ADD COLUMN IF NOT EXISTS uninstall_requested_at timestamptz;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS uninstalled_at timestamptz;
