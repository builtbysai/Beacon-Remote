import { z } from "zod";

export const sessionPermission = z.enum([
  "control",
  "files",
  "audio",
  "recording",
]);
export type SessionPermission = z.infer<typeof sessionPermission>;

const generation = z.number().int().min(0).max(1024);
export const sessionPermissionSignal = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("permission-options"),
    generation,
    scopes: z.array(sessionPermission).max(4),
  }),
  z.strictObject({
    type: z.literal("permission-request"),
    generation,
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
