/**
 * Rate limit for the signed routes a computer's own services poll (sign-in heartbeat, pending, wake; boot heartbeat).
 *
 * While a computer is locked or waiting for a sign-in lease, its sign-in service asks every second on several of
 * these routes. Under the app-wide limit (120 a minute per address, shared by every route) that alone used up the
 * budget, so the computer's other requests and, behind the same address, the owner's browser got 429 and wake and
 * readiness broke. Each of these routes gets its own per-address budget instead, sized for once-a-second polling by a
 * few computers behind one address. The key stays the client address: a machine id in the body is not authenticated
 * until the handler checks its signature, so it must not decide whose budget a request spends.
 */
export const machinePolling = {
  config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
} as const;
