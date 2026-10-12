// A clock adjustment must never extend the original viewer lifetime.
// Server/native leases remain authoritative; this bounds local playback/UI.
export function viewDeadline(
  expiresAtMillis: number,
  wallNow: () => number,
  monotonicNow: () => number,
): () => boolean {
  const remaining = Math.max(0, expiresAtMillis - wallNow());
  const deadline = monotonicNow() + remaining;
  return () => wallNow() >= expiresAtMillis || monotonicNow() >= deadline;
}
