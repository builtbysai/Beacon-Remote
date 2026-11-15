// Owner-authorized local test identity. Never accepts a database/origin override.
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  lstat,
} from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { Pool } from "pg";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import {
  readLocalDatabase,
  localDatabaseUrl,
} from "../../../scripts/local-database.mjs";

const action = z
  .enum(["create", "rotate", "remove", "status", "recover"])
  .parse(process.argv[2]);
if (!process.env.BEACON_PRIVATE_DIR)
  throw new Error("Dot-source scripts/Enter-Workspace.ps1 first.");
const file = resolve(
  process.env.BEACON_PRIVATE_DIR,
  "remote/local/accounts/temporary-development.json",
);
const insideRepository = relative(
  resolve(import.meta.dirname, "../../.."),
  file,
);
if (
  !isAbsolute(insideRepository) &&
  insideRepository !== ".." &&
  !insideRepository.startsWith(`..${sep}`)
)
  throw new Error(
    "Temporary credentials require an external private root, outside the repository.",
  );
// Cleanup/rotation must never traverse a directory junction or symbolic link.
for (const candidate of [file, file + ".pending"]) {
  let current = candidate;
  for (;;) {
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(
          "Temporary-account paths must be real private files/directories, not links.",
        );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
const shape = z
  .object({
    version: z.literal(1),
    accountId: z.uuid(),
    origin: z.literal("http://127.0.0.1:5174"),
    email: z.string().regex(/^temporary-[0-9a-f-]{36}@example\.test$/),
    password: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    createdAt: z.iso.datetime(),
  })
  .strict();
const pool = new Pool({
  connectionString: localDatabaseUrl((await readLocalDatabase()).password),
});
let saved: z.infer<typeof shape> | null = null;
try {
  try {
    saved = shape.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      // JSON/Zod causes can contain private credential values.
      // eslint-disable-next-line preserve-caught-error
      throw new Error("Cannot read the private temporary-account record.");
  }
  if (action === "status") {
    const present =
      saved &&
      (
        await pool.query("SELECT 1 FROM accounts WHERE id=$1 AND email=$2", [
          saved.accountId,
          saved.email,
        ])
      ).rowCount;
    console.log(
      `Temporary local account: ${present ? "present" : "absent"}. Credentials are never printed.`,
    );
  } else if (action === "create") {
    if (saved)
      throw new Error(
        "A temporary record already exists. Use status or rotate; it is never overwritten by create.",
      );
    const accountId = randomUUID();
    const record = shape.parse({
      version: 1,
      accountId,
      origin: "http://127.0.0.1:5174",
      email: `temporary-${accountId}@example.test`,
      password: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
    });
    await mkdir(dirname(file), { recursive: true });
    // Reserve the private file first. A DB failure leaves an identifiable record for remove.
    await writeFile(file, JSON.stringify(record, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await pool.query(
      "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3)",
      [accountId, record.email, await hash(record.password)],
    );
    console.log("Temporary local account created. Private record: " + file);
  } else if (action === "recover") {
    if (!saved) throw new Error("No temporary local account record exists.");
    let pending: z.infer<typeof shape>;
    try {
      pending = shape.parse(
        JSON.parse(await readFile(file + ".pending", "utf8")),
      );
    } catch {
      // Parser errors may contain a credential. Never include them in output.
      throw new Error("No readable pending temporary-account rotation exists.");
    }
    if (pending.accountId !== saved.accountId || pending.email !== saved.email)
      throw new Error("Pending rotation belongs to a different account.");
    const row = (
      await pool.query<{ password_hash: string }>(
        "SELECT password_hash FROM accounts WHERE id=$1 AND email=$2",
        [saved.accountId, saved.email],
      )
    ).rows[0];
    if (!row)
      throw new Error("The recorded temporary local account is missing.");
    if (await verify(row.password_hash, pending.password)) {
      await rename(file + ".pending", file);
      console.log("Completed the committed temporary-account rotation.");
    } else if (await verify(row.password_hash, saved.password)) {
      await unlink(file + ".pending");
      console.log("Discarded the uncommitted temporary-account rotation.");
    } else
      throw new Error(
        "Neither private record matches the temporary local account. No file changed.",
      );
  } else {
    if (!saved) throw new Error("No temporary local account record exists.");
    if (action === "remove") {
      const pending = await lstat(file + ".pending").then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (pending)
        throw new Error(
          "Resolve the pending temporary-account rotation with recover before removal.",
        );
    }
    const client = await pool.connect();
    const next = { ...saved, password: randomBytes(32).toString("base64url") };
    const pending = file + ".pending";
    try {
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT 1 FROM accounts WHERE id=$1 AND email=$2 FOR UPDATE",
        [saved.accountId, saved.email],
      );
      if (action === "rotate") {
        if (!found.rowCount)
          throw new Error("The recorded temporary local account is missing.");
        // Keep the replacement recoverable if committing or renaming fails; no old session survives rotation.
        await writeFile(pending, JSON.stringify(next, null, 2) + "\n", {
          flag: "wx",
          mode: 0o600,
        });
        await client.query("UPDATE accounts SET password_hash=$2 WHERE id=$1", [
          saved.accountId,
          await hash(next.password),
        ]);
        await client.query("DELETE FROM browser_sessions WHERE account_id=$1", [
          saved.accountId,
        ]);
      } else if (found.rowCount) {
        await client.query("DELETE FROM accounts WHERE id=$1 AND email=$2", [
          saved.accountId,
          saved.email,
        ]);
      }
      await client.query("COMMIT");
      if (action === "rotate") await rename(pending, file);
      else await unlink(file);
      console.log(
        `Temporary local account ${action === "rotate" ? "rotated; existing browser sessions invalidated" : "removed with its browser sessions and enrolled test devices"}.`,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
