import {
  readLocalDatabase,
  localDatabaseUrl,
} from "../../../scripts/local-database.mjs";
// Isolated, loopback-only fixture for driving a real Windows host on the lab laptop (docs: scripts/lab/README.md).
// It starts a backend on 3012 (media and control enabled) and the web app on 5176, both on 127.0.0.1 only, in a
// throwaway schema, with a test account. The laptop reaches the backend through an SSH reverse tunnel, so its host sees
// the loopback address it is allowed to use over plain HTTP. A fresh pairing code is written to the state folder every
// few minutes until a computer is paired. The schema is dropped when this stops.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { createServer } from "vite";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

const root = resolve(import.meta.dirname, "../../..");
const database = localDatabaseUrl(
  (await readLocalDatabase()).password,
  "beacon_remote_test",
);
const admin = new Pool({ connectionString: database });
// LAB_SCHEMA reuses a schema left by an earlier run (stopped without its cleanup), so the paired laptop and its
// sign-in service keep working across a fixture restart; such a schema is kept on exit too.
const kept = process.env.LAB_SCHEMA;
if (kept !== undefined && !/^lab_dev_[0-9a-f]{32}$/.test(kept))
  throw new Error("LAB_SCHEMA must name an earlier lab_dev_ schema");
const schema = kept ?? `lab_dev_${randomUUID().replaceAll("-", "")}`;
if (kept === undefined) await admin.query(`CREATE SCHEMA ${schema}`);
else if (
  !(
    await admin.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name=$1",
      [schema],
    )
  ).rowCount
)
  throw new Error(`No schema ${schema}`);
const pool = new Pool({
  connectionString: database,
  options: `-c search_path=${schema}`,
});
const origin = "http://127.0.0.1:5176";
const api = 3012;
const state = resolve(
  process.env.REMOTE_DEV_STATE_DIR ??
    resolve(root, "../../Beacon-Secrets/remote/local/state"),
  "lab-development",
);
const loginPath = resolve(
  process.env.REMOTE_LOCAL_ACCOUNTS_DIR ??
    resolve(root, "../../Beacon-Secrets/remote/local/accounts"),
  "lab.json",
);
let account = randomUUID();
const email = `lab-${account}@example.test`;
const password = randomBytes(32).toString("base64url");
let web: Awaited<ReturnType<typeof createServer>> | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let ending = false;
let refresh: NodeJS.Timeout | undefined;
async function stop() {
  if (ending) return;
  ending = true;
  clearInterval(refresh);
  await app?.close();
  await web?.close();
  await pool.end();
  if (kept === undefined) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
try {
  await applyMigrations(pool);
  // A kept schema keeps its account and the login file that names it.
  if (kept !== undefined)
    account = (
      await pool.query<{ id: typeof account }>(
        "SELECT id FROM accounts LIMIT 1",
      )
    ).rows[0]!.id;
  else
    await pool.query(
      "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
      [account, email, await hash(password)],
    );
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '8 hours')",
    [createHash("sha256").update(token).digest("hex"), account],
  );
  app = await createApp(pool, {
    DATABASE_URL: database,
    WEB_ORIGIN: origin,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: api,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    CONTROL_ENABLED: "true",
    SIGNIN_AUTHORITY_ENABLED: "true",
    SIGNIN_MEDIA_ENABLED: "true",
  });
  await app.listen({ host: "127.0.0.1", port: api });
  process.env.REMOTE_API_ORIGIN = `http://127.0.0.1:${api}`;
  web = await createServer({
    root: resolve(root, "apps/web"),
    configFile: resolve(root, "apps/web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 5176, strictPort: true },
  });
  await web.listen();
  await mkdir(state, { recursive: true });
  await mkdir(dirname(loginPath), { recursive: true });
  if (kept === undefined)
    await writeFile(loginPath, JSON.stringify({ origin, email, password }));
  const newCode = async () => {
    const machines = await pool.query(
      "SELECT count(*)::int AS n FROM machines",
    );
    if (machines.rows[0].n > 0) return;
    const made = await app!.inject({
      method: "POST",
      url: "/api/enrollments",
      headers: { origin, cookie: `remote_session=${token}` },
      payload: {},
    });
    if (made.statusCode === 200)
      await writeFile(
        resolve(state, "pairing.json"),
        JSON.stringify({ code: made.json().code, at: Date.now() }),
      );
  };
  await newCode();
  refresh = setInterval(() => void newCode().catch(() => undefined), 240_000);
  await writeFile(
    resolve(state, "session.json"),
    JSON.stringify({ origin, api: `http://127.0.0.1:${api}`, cookie: token }),
  );
  console.log(
    `Lab fixture: web ${origin}, API http://127.0.0.1:${api}. Login in ${loginPath}; pairing code in ${state}.`,
  );
} catch (error) {
  await stop();
  throw error;
}
