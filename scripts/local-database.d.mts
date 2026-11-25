export function readLocalDatabase(options?: {
  file?: string;
}): Promise<{ password: string }>;
export function localDatabaseUrl(
  password: string,
  database?: "beacon_remote_dev" | "beacon_remote_test",
): string;
