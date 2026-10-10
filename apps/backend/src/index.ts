import { Pool } from "pg";
import { parseConfig } from "./config.js";
import { createApp } from "./app.js";
import { endInterruptedSessions } from "./sessions.js";

const config = parseConfig(process.env);
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 8 });
const app = await createApp(pool, config);
app.addHook("onClose", () => pool.end());
try {
  await endInterruptedSessions(pool);
} catch (error) {
  await app.close();
  throw error;
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
await app.listen({ host: config.HOST, port: config.PORT });
