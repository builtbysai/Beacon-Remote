// Isolated, loopback-only fixture for trying one-click temporary support by hand (ADR 0038). It starts the backend on
// 3011 and the web app on 5175 in a throwaway schema, signs a technician in, creates a support link and prints it.
// Run the support program against it with BEACON_SERVER=http://127.0.0.1:3011 (see docs/input-development.md).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { createServer } from "../../web/node_modules/vite/dist/node/index.js";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

const root = resolve(import.meta.dirname, "../../..");
const database =
  "postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test";
const admin = new Pool({ connectionString: database });
const schema = `support_dev_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool = new Pool({
  connectionString: database,
  options: `-c search_path=${schema}`,
});
const origin = "http://127.0.0.1:5175";
const state = resolve(root, ".remote-dev/support-development");
const account = randomUUID();
const email = `tech-${account}@example.test`;
const password = randomBytes(32).toString("base64url");
let web: Awaited<ReturnType<typeof createServer>> | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let ending = false;
async function stop() {
  if (ending) return;
  ending = true;
  await app?.close();
  await web?.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  await applyMigrations(pool);
  await pool.query(
    "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
    [account, email, await hash(password)],
  );
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '4 hours')",
    [createHash("sha256").update(token).digest("hex"), account],
  );
  app = await createApp(pool, {
    DATABASE_URL: database,
    WEB_ORIGIN: origin,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: 3011,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    CONTROL_ENABLED: "true",
    STUN_URL: "stun:stun.l.google.com:19302",
  });
  await app.listen({ host: "127.0.0.1", port: 3011 });
  process.env.REMOTE_API_ORIGIN = "http://127.0.0.1:3011";
  web = await createServer({
    root: resolve(root, "apps/web"),
    configFile: resolve(root, "apps/web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 5175, strictPort: true },
  });
  await web.listen();
  const made = await app.inject({
    method: "POST",
    url: "/api/support-links",
    headers: { origin, cookie: `remote_session=${token}` },
    payload: {
      capability: process.env.SUPPORT_CONTROL
        ? "desktop:control"
        : "desktop:view",
      label: "Fixture",
    },
  });
  await mkdir(state, { recursive: true });
  await writeFile(
    resolve(state, "login.json"),
    JSON.stringify({
      origin,
      email,
      password,
      cookie: token,
      link: made.json().url,
    }),
  );
  console.log(
    `Support fixture: ${origin} (login in ${state}). Link: ${made.json().url}`,
  );
} catch (error) {
  await stop();
  throw error;
}
