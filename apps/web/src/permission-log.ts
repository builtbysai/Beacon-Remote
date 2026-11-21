// A short record, in this browser only, of what the device allowed or refused during one session.
export type PermissionLogEntry = {
  at: number;
  scope: string;
  outcome: "approved" | "denied" | "cancelled" | "expired";
};

const words: Record<PermissionLogEntry["outcome"], string> = {
  approved: "allowed on the device",
  denied: "declined on the device",
  cancelled: "cancelled",
  expired: "expired",
};

const names: Record<string, string> = {
  files: "Files",
  control: "Control",
  recording: "Recording",
};

export function permissionLogLine(
  entry: PermissionLogEntry,
  clock = (at: number) => new Date(at).toLocaleTimeString(),
): string {
  const name =
    names[entry.scope] ??
    entry.scope.charAt(0).toUpperCase() + entry.scope.slice(1);
  return `${clock(entry.at)} ${name}: ${words[entry.outcome]}`;
}

export function addPermissionLog(
  log: PermissionLogEntry[],
  entry: PermissionLogEntry,
  limit = 50,
): PermissionLogEntry[] {
  return [...log, entry].slice(-limit);
}
