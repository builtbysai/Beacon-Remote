import { z } from "zod";

// P1-4 drive/folder redirection: the viewer's explicitly chosen local folder, mapped into the remote
// session under one revocable grant. The protocol names only the bounded vocabulary; the host enforces the
// folder root, rights and expiry locally, and a grant is never a whole-disk or home-directory mapping.

/** One path segment: a plain name with no separators, traversal, drive prefixes or control characters. */
const segment = z
  .string()
  .min(1)
  .max(255)
  .refine((name) => name !== "." && name !== "..", "relative traversal")
  .refine(
    (name) => ![...name].some((char) => char.charCodeAt(0) < 32),
    "control character",
  )
  .refine((name) => !/[\\/:*?"<>|]/.test(name), "unsafe character")
  .refine((name) => !/[. ]$/.test(name), "Windows trailing dot or space")
  .refine(
    (name) => !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(name),
    "reserved device name",
  );

/** A path relative to the mapped root, at most 32 segments deep. */
export const drivePath = z.array(segment).max(32);

export const driveRights = z.enum(["read", "write"]);
export type DriveRights = z.infer<typeof driveRights>;

const generation = z.number().int().min(0).max(1024);
const grantId = z.uuid();

/** Offered by the viewer when the owner picks a folder; the host approves it locally before any use. */
export const driveMappingRequest = z.strictObject({
  type: z.literal("drive-map-request"),
  generation,
  id: grantId,
  label: z.string().min(1).max(64),
  rights: driveRights,
  expiresInSeconds: z
    .number()
    .int()
    .positive()
    .max(8 * 60 * 60),
});

/** Commands run against an approved mapping. Every one is bounded and tied to the grant id. */
export const driveCommand = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("list"), grant: grantId, path: drivePath }),
  z.strictObject({
    op: z.literal("stat"),
    grant: grantId,
    path: drivePath,
  }),
  z.strictObject({
    op: z.literal("read"),
    grant: grantId,
    path: drivePath,
    offset: z
      .number()
      .int()
      .min(0)
      .max(2 ** 53 - 1),
    length: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024),
  }),
  z.strictObject({
    op: z.literal("write"),
    grant: grantId,
    path: drivePath,
    offset: z
      .number()
      .int()
      .min(0)
      .max(2 ** 53 - 1),
    length: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024),
  }),
  z.strictObject({
    op: z.literal("rename"),
    grant: grantId,
    from: drivePath.min(1),
    to: drivePath.min(1),
  }),
  z.strictObject({
    op: z.literal("delete"),
    grant: grantId,
    path: drivePath.min(1),
  }),
  z.strictObject({
    op: z.literal("mkdir"),
    grant: grantId,
    path: drivePath.min(1),
  }),
]);
export type DriveCommand = z.infer<typeof driveCommand>;

/** Results and revocations sent back to the viewer. */
export const driveEvent = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("drive-map-result"),
    generation,
    id: grantId,
    outcome: z.enum(["approved", "denied", "cancelled", "expired"]),
  }),
  z.strictObject({
    type: z.literal("drive-map-revoked"),
    generation,
    grant: grantId,
    reason: z.enum(["owner", "expired", "session-ended", "folder-missing"]),
  }),
]);
export type DriveEvent = z.infer<typeof driveEvent>;
