import { ApiError } from "./api.js";

// A dropped connection is not the end of an authorized session (ADR 0021). The viewer keeps
// asking the server to resume the same session, with backed-off retries, for as long as the
// server holds it. The server decides: a refusal ends the session, an outage does not.
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

export function backoffDelay(attempt: number, random = Math.random): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  return Math.round(base * (0.8 + random() * 0.4));
}

// The server saying no (signed out, revoked, ended, changed) is final. Offline, a timeout, a
// rate limit or a restarting server is not.
export function isRefusal(error: unknown): boolean {
  if (error instanceof ApiError)
    return (
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 429
    );
  return (
    error instanceof Error && error.message === "Recovery changed authorization"
  );
}

export async function reconnectUntil<T>(options: {
  attempt: () => Promise<T | null>;
  isCurrent: () => boolean;
  windowMs: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}): Promise<T | null> {
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? (() => performance.now());
  const giveUpAt = now() + options.windowMs;
  for (let attempt = 0; ; attempt++) {
    if (!options.isCurrent()) return null;
    if (now() >= giveUpAt) throw new Error("Reconnect window ended");
    if (attempt > 0) await sleep(backoffDelay(attempt - 1, options.random));
    if (!options.isCurrent()) return null;
    try {
      return await options.attempt();
    } catch (error) {
      if (isRefusal(error)) throw error;
    }
  }
}
