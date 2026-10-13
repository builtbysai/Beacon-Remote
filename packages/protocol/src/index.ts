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

// A display the computer reports. The id is the Windows device name, never user text.
export const displayInfo = z
  .object({
    id: z.string().regex(/^\\\\\.\\DISPLAY\d{1,3}$/),
    width: z.number().int().min(1).max(32768),
    height: z.number().int().min(1).max(32768),
    primary: z.boolean(),
  })
  .strict();
export type DisplayInfo = z.infer<typeof displayInfo>;

export const heartbeat = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    machineId: z.string().uuid(),
    timestamp: z.number().int().positive(),
    nonce: z.string().uuid(),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
    displays: z.array(displayInfo).max(8).optional(),
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

// Whether remembered helpers may connect without the local Allow, set only by the computer itself.
export const helpersLevel = z.enum(["off", "view", "control"]);
export const helpersRequest = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    machineId: z.string().uuid(),
    timestamp: z.number().int().positive(),
    nonce: z.string().uuid(),
    level: helpersLevel,
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();

export function helpersMessage(
  machineId: string,
  timestamp: number,
  nonce: string,
  level: z.infer<typeof helpersLevel>,
): string {
  return `beacon-remote:helpers:v1\n${machineId}\n${timestamp}\n${nonce}\n${level}`;
}

// The person at the computer asks for a one-time support code, signed with the computer's key.
export const supportRequest = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    machineId: z.string().uuid(),
    timestamp: z.number().int().positive(),
    nonce: z.string().uuid(),
    capability,
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();

export function supportMessage(
  machineId: string,
  timestamp: number,
  nonce: string,
  requested: z.infer<typeof capability>,
): string {
  return `beacon-remote:support:v1\n${machineId}\n${timestamp}\n${nonce}\n${requested}`;
}

// Support codes avoid look-alike characters; they are typed by a person from a voice or chat.
export const SUPPORT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const supportCode = z
  .string()
  .transform((value) => value.toUpperCase().replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/));

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
  // The owner's own label for organising many computers; null when unset.
  group: string | null;
  online: boolean;
  lastSeenAt: string | null;
  revokedAt: string | null;
  // The computer's own access policy (ADR 0021). Only the computer can raise it.
  accessMode: "attended" | "trusted";
  allowControl: boolean;
  helpersUnattended: "off" | "view" | "control";
  displays: DisplayInfo[];
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
      z.object({ type: z.literal("clipboard_read") }).strict(),
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
