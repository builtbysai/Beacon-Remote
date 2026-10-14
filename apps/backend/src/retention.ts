// Housekeeping: rows that only exist to authorise something that has long since expired. Records the owner can read
// (sessions, activity, computers) are never touched here.
import type { Pool } from "pg";

export async function purgeStale(pool: Pool): Promise<void> {
  await pool.query("DELETE FROM browser_sessions WHERE expires_at<now()");
  await pool.query(
    "DELETE FROM enrollments WHERE expires_at<now()-interval '1 day'",
  );
  await pool.query(
    "DELETE FROM support_invitations WHERE expires_at<now()-interval '1 day'",
  );
  await pool.query(
    "DELETE FROM heartbeat_nonces WHERE received_at<now()-interval '1 day'",
  );
  // Finished or never-used support links go after 30 days, with the temporary computer they made.
  await pool.query(
    `DELETE FROM support_links
     WHERE ended_at<now()-interval '30 days' OR (claimed_at IS NULL AND expires_at<now()-interval '30 days')`,
  );
}
