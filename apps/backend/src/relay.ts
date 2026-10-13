import { createHmac } from "node:crypto";
import type { Config } from "./config.js";

// Coturn REST credentials are short and re-issued while the session stays authorized (ADR 0021);
// they never decide how long a session lives. The username contains an opaque session ID,
// not an email or machine name.
export const RELAY_CREDENTIAL_MINUTES = 30;
export function relayExpiry(sessionCap: Date, now = Date.now()) {
  return new Date(
    Math.min(sessionCap.getTime(), now + RELAY_CREDENTIAL_MINUTES * 60_000),
  );
}
export function relayCredentials(config: Config, id: string, expiresAt: Date) {
  if (!config.TURN_URLS || !config.TURN_SECRET)
    throw new Error("Relay unavailable");
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
  if (expiresAtSeconds <= Math.floor(Date.now() / 1000))
    throw new Error("Session expired");
  const username = `${expiresAtSeconds}:beacon-remote:${id}`;
  return {
    urls: config.TURN_URLS,
    username,
    credential: createHmac("sha1", config.TURN_SECRET)
      .update(username)
      .digest("base64"),
    expiresAtMillis: expiresAtSeconds * 1000,
  };
}
