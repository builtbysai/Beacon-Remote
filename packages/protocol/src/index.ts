import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const capability = z.enum(["desktop:view", "desktop:control"]);
export const enrollment = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    code: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
    name: z.string().trim().min(1).max(80),
    publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .strict();

export const heartbeat = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    machineId: z.string().uuid(),
    timestamp: z.number().int().positive(),
    nonce: z.string().uuid(),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();

// Exact canonical bytes signed by the native agent. No user-defined payload.
export function heartbeatMessage(
  machineId: string,
  timestamp: number,
  nonce: string,
): string {
  return `beacon-remote:heartbeat:v1\n${machineId}\n${timestamp}\n${nonce}`;
}

// A computer raises or lowers its own access policy with the same key that signs presence.
// Only the computer can make itself reachable without a local Allow; the web app can only lower it.
export const accessPolicy = z.enum(["attended", "trusted"]);
export const accessRequest = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    machineId: z.string().uuid(),
    timestamp: z.number().int().positive(),
    nonce: z.string().uuid(),
    mode: accessPolicy,
    allowControl: z.boolean(),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict()
  .refine((request) => request.mode === "trusted" || !request.allowControl);

export function accessMessage(
  machineId: string,
  timestamp: number,
  nonce: string,
  mode: "attended" | "trusted",
  allowControl: boolean,
): string {
  return `beacon-remote:access:v1\n${machineId}\n${timestamp}\n${nonce}\n${mode}\n${allowControl}`;
}

export interface Machine {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

// Later WebRTC: reliable ordered state/keys/buttons; unreliable unordered pointer
// movement only. Every frame includes session + lease identity and sequence.
export const inputEnvelope = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    sessionId: z.string().uuid(),
    leaseId: z.string().uuid(),
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    input: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("move_pointer"),
          displayId: z.string().min(1).max(80),
          x: z.number().int().nonnegative(),
          y: z.number().int().nonnegative(),
        })
        .strict(),
      z
        .object({
          type: z.literal("button"),
          button: z.enum(["left", "right", "middle"]),
          down: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal("scroll"),
          horizontal: z.number().int().min(-32767).max(32767),
          vertical: z.number().int().min(-32767).max(32767),
        })
        .strict(),
      z.object({ type: z.literal("release_all") }).strict(),
      z.object({ type: z.literal("keep_alive") }).strict(),
      z
        .object({
          type: z.literal("type_text"),
          text: z
            .string()
            .min(1)
            .max(256)
            .refine((text) =>
              Array.from(text).every((character) => {
                const code = character.charCodeAt(0);
                return code >= 32 && (code < 127 || code > 159);
              }),
            ),
        })
        .strict(),
      z
        .object({
          type: z.literal("key"),
          scanCode: z.number().int().min(1).max(127),
          extended: z.boolean(),
          down: z.boolean(),
        })
        .strict(),
    ]),
  })
  .strict();
