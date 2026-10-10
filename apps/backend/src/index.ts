import { Pool } from "pg";
import { parseConfig } from "./config.js";
import { createApp } from "./app.js";
import { endInterruptedSessions } from "./sessions.js";
import { acquireBackendOwnership } from "./backend-ownership.js";

const config = parseConfig(process.env);
const ownership = await acquireBackendOwnership(config.DATABASE_URL, () => {
  // Do not serve or wait for database-dependent cleanup after losing ownership.
  // Socket EOF stops peers; the replacement performs persisted-grant recovery.
  console.error("Backend database ownership lost; stopping");
  process.exit(1);
});
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 8 });
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let shutdownPromise: Promise<void> | undefined;
function shutdown() {
  return (shutdownPromise ??= (async () => {
    try {
      // Session shutdown hooks still need the request pool.
      await app?.close();
    } finally {
      try {
        await pool.end();
      } finally {
        await ownership.close();
      }
    }
  })());
}
try {
  app = await createApp(pool, config);
  await endInterruptedSessions(pool);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdown().catch(() => {
        console.error("Backend shutdown failed");
        process.exit(1);
      });
    });
  }
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  await shutdown();
  throw error;
}
