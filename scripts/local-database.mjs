import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Only a password is configurable: fixtures cannot redirect themselves to a hosted database. */
export async function readLocalDatabase(options = {}) {
  const explicit = options.file ?? process.env.REMOTE_DEV_DATABASE_FILE;
  const file =
    explicit ??
    join(
      process.env.BEACON_PRIVATE_DIR ?? join(root, "../../Beacon-Secrets"),
      "remote/local/database.json",
    );
  let settings;
  try {
    settings = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (!explicit && error.code === "ENOENT")
      return { password: "development-only" };
    // JSON parser causes can contain the private file contents.
    // eslint-disable-next-line preserve-caught-error
    throw new Error("Cannot read the selected private local database file");
  }
  if (
    !settings ||
    Array.isArray(settings) ||
    Object.keys(settings).length !== 1 ||
    typeof settings.password !== "string" ||
    !settings.password.length ||
    settings.password.length > 512
  ) {
    throw new Error(
      "Private local database configuration must contain only a nonempty password",
    );
  }
  return { password: settings.password };
}

export function localDatabaseUrl(password, database = "beacon_remote_dev") {
  if (!["beacon_remote_dev", "beacon_remote_test"].includes(database))
    throw new Error(
      "Only Remote's local development/test databases are allowed",
    );
  const url = new URL(`postgresql://remote_dev@127.0.0.1:5433/${database}`);
  url.password = password;
  return url.href;
}
