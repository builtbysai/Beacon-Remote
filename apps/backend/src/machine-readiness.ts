// Static SQL for a machines row aliased as m. Boot presence can make a recent
// interactive heartbeat unavailable, but can never make a stale one available.
// Use the same rule in inventory and session admission, including helper access.
export const interactiveReadySql = `COALESCE((m.revoked_at IS NULL
  AND m.last_seen_at>now()-interval '45 seconds'
  AND NOT EXISTS (
    SELECT 1 FROM boot_agents readiness_boot WHERE readiness_boot.machine_id=m.id
      AND readiness_boot.last_seen_at>now()-interval '45 seconds'
      AND readiness_boot.state IN ('signed-out','locked')
  )),false)`;
