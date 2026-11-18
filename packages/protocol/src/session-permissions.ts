import { z } from "zod";

export const sessionPermission = z.enum([
  "control",
  "files",
  "audio",
  "recording",
  "drive",
]);
export type SessionPermission = z.infer<typeof sessionPermission>;

const generation = z.number().int().min(0).max(1024);
const options = z.strictObject({
  type: z.literal("permission-options"),
  generation,
  scopes: z.array(sessionPermission).max(5),
});
export const sessionPermissionSignal = z.discriminatedUnion("type", [
  options,
  z.strictObject({ type: z.literal("permission-hello"), generation }),
  z.strictObject({
    type: z.literal("permission-request"),
    generation,
    attempt: z.uuid(),
    scope: sessionPermission,
  }),
  z.strictObject({
    type: z.literal("permission-cancel"),
    generation,
    id: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("permission-decision"),
    generation,
    id: z.uuid(),
    approved: z.boolean(),
  }),
]);
export type SessionPermissionSignal = z.infer<typeof sessionPermissionSignal>;

export const viewerPermissionSignal = z.discriminatedUnion("type", [
  options,
  z.strictObject({
    type: z.literal("permission-pending"),
    generation,
    attempt: z.uuid(),
    id: z.uuid(),
    scope: sessionPermission,
    timeoutMs: z.number().int().positive().max(30_000),
  }),
  z.strictObject({
    type: z.literal("permission-result"),
    generation,
    id: z.uuid(),
    outcome: z.enum(["approved", "denied", "cancelled", "expired"]),
  }),
  z.strictObject({
    type: z.literal("permission-unavailable"),
    generation,
    attempt: z.uuid(),
    scope: sessionPermission,
  }),
]);
export type ViewerPermissionSignal = z.infer<typeof viewerPermissionSignal>;
