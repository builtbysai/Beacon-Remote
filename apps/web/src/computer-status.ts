// A signed-in, unlocked computer whose desktop host is not connected is either starting (after sign-in or a restart)
// or reconnecting (it was online moments ago and lost its network). Saying "Starting" for a network drop misleads.
export const RECONNECT_WINDOW_MS = 3 * 60_000;

export function hostReturning(
  lastSeenAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && now - seen <= RECONNECT_WINDOW_MS;
}

export function startingLabel(
  lastSeenAt: string | null | undefined,
  now = Date.now(),
): string {
  return hostReturning(lastSeenAt, now) ? "Reconnecting…" : "Starting host";
}
