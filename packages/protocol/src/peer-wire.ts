import { z } from "zod";

// What a host sends beside an offer so the viewer can check who made it (ADR 0061). The server relays it unchanged and
// cannot forge it. All values are public: a delegation signed by the computer's machine key and a statement signed with
// the key that delegation names. The rules for checking them are in peer-identity.ts.
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const instant = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const hostProofWire = z.strictObject({
  delegation: z.strictObject({
    sessionId: z.uuid(),
    sessionKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAtMs: instant,
    signature,
  }),
  statement: z.strictObject({
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    expiresAtMs: instant,
    signature,
  }),
});
export type HostProofWire = z.infer<typeof hostProofWire>;
