import { readdir, readFile } from "node:fs/promises";

// Every numbered migration in order. Adding a migration needs no other edit.
export async function applyMigrations(db: {
  query: (sql: string) => Promise<unknown>;
}) {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => /^[0-9]{3}_.+\.sql$/.test(file))
    .sort();
  for (const file of files)
    await db.query(await readFile(new URL(file, directory), "utf8"));
}
