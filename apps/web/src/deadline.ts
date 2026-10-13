// A clock adjustment must never extend the original viewer lifetime.
// Server/native leases remain authoritative; this bounds local playback/UI.
export function viewDeadline(
  expiresAtMillis: number,
  wallNow: () => number,
  monotonicNow: () => number,
): () => boolean {
  // Explicit server-issued unlimited development grant. Live server/native
  // renewal and Stop still govern authorization; this disables only a fixed UI timer.
  if (expiresAtMillis === 0) return () => false;
  const remaining = Math.max(0, expiresAtMillis - wallNow());
  const deadline = monotonicNow() + remaining;
  return () => wallNow() >= expiresAtMillis || monotonicNow() >= deadline;
}
