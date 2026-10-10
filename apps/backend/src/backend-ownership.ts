import { Client } from "pg";

// Database-scoped, session-level ownership: never return this connection to a pool.
const ownershipKey = [0x42454143, 0x52454d4f];

export async function acquireBackendOwnership(
  connectionString: string,
  onLost: () => void,
) {
  const client = new Client({
    connectionString,
    application_name: "beacon-remote-owner",
    connectionTimeoutMillis: 5000,
    keepAlive: true,
  });
  let held = false;
  let closing = false;
  const lost = () => {
    if (!held || closing) return;
    held = false;
    onLost();
  };
  client.on("error", lost);
  client.on("end", lost);
  try {
    await client.connect();
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      ownershipKey,
    );
    if (!result.rows[0]?.acquired)
      throw new Error("Another Beacon Remote backend owns this database");
    held = true;
  } catch (error) {
    closing = true;
    await client.end();
    throw error;
  }
  return {
    async close() {
      closing = true;
      held = false;
      // Closing the dedicated session releases its advisory lock.
      await client.end();
    },
  };
}
