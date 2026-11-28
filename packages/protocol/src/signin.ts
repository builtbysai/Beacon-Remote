import { z } from "zod";

export const signinAttentionInput = z
  .object({ type: z.literal("secure_attention") })
  .strict();

// Deliberately distinct from boot presence and ordinary desktop authorization.
const signed = {
  version: z.literal(1),
  machineId: z.uuid(),
  timestamp: z.number().int().positive(),
  nonce: z.uuid(),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
} as const;
// Lower-only service action, independent of worker/console availability.
export const signinDisableProof = z.object(signed).strict();
export function signinDisableMessage(
  b: z.infer<typeof signinDisableProof>,
): string {
  return `beacon-remote:signin-disable:v1\n${b.machineId}\n${b.timestamp}\n${b.nonce}`;
}
export const signinBinding = z
  .object({
    ...signed,
    publicKey: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .nullable(),
  })
  .strict();
export const signinHeartbeat = z
  .object({
    ...signed,
    instanceId: z.uuid(),
    consoleSessionId: z.number().int().min(1).max(0xfffffffe),
    state: z.enum(["unavailable", "sign-in", "signed-in"]),
    // The native endpoint must establish its worker/desktop boundary before reporting ready.
    workerReady: z.boolean(),
    // Present only in canonical domain v2. The private key remains in the
    // scoped worker; legacy presence has no worker transport credential.
    workerPublicKey: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((b) => !b.workerReady || b.state === "sign-in")
  .refine((b) => b.state === "sign-in" || b.workerPublicKey == null)
  .refine((b) => !b.workerReady || b.workerPublicKey !== null);
export function signinBindingMessage(b: z.infer<typeof signinBinding>): string {
  return `beacon-remote:signin-binding:v1\n${b.machineId}\n${b.timestamp}\n${b.nonce}\n${b.publicKey ?? "off"}`;
}
export function signinHeartbeatMessage(
  b: z.infer<typeof signinHeartbeat>,
): string {
  const domain = b.workerPublicKey === undefined ? "v1" : "v2";
  return `beacon-remote:signin-heartbeat:${domain}\n${b.machineId}\n${b.timestamp}\n${b.nonce}\n${b.instanceId}\n${b.consoleSessionId}\n${b.state}\n${b.workerReady ? "ready" : "unavailable"}${b.workerPublicKey === undefined ? "" : `\n${b.workerPublicKey ?? "off"}`}`;
}

export const signinLeaseProof = z
  .object({
    ...signed,
    leaseId: z.uuid(),
    instanceId: z.uuid(),
    consoleSessionId: z.number().int().min(1).max(0xfffffffe),
  })
  .strict();
export const signinPendingProof = z
  .object({
    ...signed,
    instanceId: z.uuid(),
    consoleSessionId: z.number().int().min(1).max(0xfffffffe),
  })
  .strict();
export function signinPendingProofMessage(
  b: z.infer<typeof signinPendingProof>,
): string {
  return `beacon-remote:signin-pending:v1\n${b.machineId}\n${b.timestamp}\n${b.nonce}\n${b.instanceId}\n${b.consoleSessionId}`;
}
// A locked console showing the lock-screen picture asks whether a viewer wants the
// password prompt raised. The answer is a yes/no only; it carries no lease or grant.
export const signinWakeProof = z
  .object({
    ...signed,
    consoleSessionId: z.number().int().min(1).max(0xfffffffe),
  })
  .strict();
export function signinWakeProofMessage(
  b: z.infer<typeof signinWakeProof>,
): string {
  return `beacon-remote:signin-wake:v1\n${b.machineId}\n${b.timestamp}\n${b.nonce}\n${b.consoleSessionId}`;
}
export function signinLeaseProofMessage(
  b: z.infer<typeof signinLeaseProof>,
): string {
  return `beacon-remote:signin-lease:v1\n${b.machineId}\n${b.timestamp}\n${b.nonce}\n${b.leaseId}\n${b.instanceId}\n${b.consoleSessionId}`;
}

// Same bounded identity fields, deliberately distinct signature purpose/key.
export const signinWorkerConnectProof = signinLeaseProof;
export function signinWorkerConnectMessage(
  b: z.infer<typeof signinWorkerConnectProof>,
): string {
  return `beacon-remote:signin-worker-connect:v1\n${b.machineId}\n${b.timestamp}\n${b.nonce}\n${b.leaseId}\n${b.instanceId}\n${b.consoleSessionId}`;
}
export const signinHandoffProof = signinLeaseProof;
export function signinHandoffMessage(
  b: z.infer<typeof signinHandoffProof>,
): string {
  return `beacon-remote:signin-handoff:v1\n${b.machineId}\n${b.timestamp}\n${b.nonce}\n${b.leaseId}\n${b.instanceId}\n${b.consoleSessionId}`;
}
export const signinHandoffStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }).strict(),
  z
    .object({
      state: z.literal("ready"),
      machineId: z.uuid(),
      leaseId: z.uuid(),
      instanceId: z.uuid(),
      consoleSessionId: z.number().int().min(1).max(0xfffffffe),
      hostContext: z
        .object({
          instanceId: z.uuid(),
          consoleSessionId: z.number().int().min(1).max(0xfffffffe),
        })
        .strict(),
    })
    .strict(),
]);

// Browser-visible reservations are separate from ordinary desktop grants.
// Neither metadata nor a reservation establishes a live native media peer.
export const signinLeaseRenewal = z
  .object({
    scope: z.literal("windows:sign-in"),
    expiresAtMillis: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const signinLeaseReservation = signinLeaseRenewal
  .extend({
    id: z.uuid(),
    connectable: z.boolean(),
    files: z.literal(false),
    clipboard: z.literal(false),
    audio: z.literal(false),
    recording: z.literal(false),
    automation: z.literal(false),
  })
  .strict();
export type SignInLeaseReservation = z.infer<typeof signinLeaseReservation>;

const signinContext = {
  scope: z.literal("windows:sign-in"),
  leaseId: z.uuid(),
  instanceId: z.uuid(),
  consoleSessionId: z.number().int().min(1).max(0xfffffffe),
} as const;
export const signinScopeContext = z.object(signinContext).strict();
export const signinAttentionResult = z
  .object({
    ...signinContext,
    type: z.literal("secure-attention"),
    version: z.literal(1),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    status: z.enum(["requested", "policy-unavailable", "unavailable"]),
  })
  .strict();
export const signinSignalReady = z
  .object({
    type: z.literal("ready"),
    ...signinContext,
    workerPublicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
    iceServers: z
      .array(
        z
          .object({
            urls: z
              .array(
                z
                  .string()
                  .min(1)
                  .max(256)
                  .regex(/^(stun|turn|turns):[^\s/@#]+$/),
              )
              .min(1)
              .max(3),
            username: z.string().min(1).max(256).optional(),
            credential: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    iceTransportPolicy: z.enum(["all", "relay"]),
    files: z.literal(false),
    clipboard: z.literal(false),
    audio: z.literal(false),
    recording: z.literal(false),
    automation: z.literal(false),
  })
  .strict();
// A handoff still receives an ordinary grant under freshly checked policy.
export const signinDesktopGrant = z
  .object({
    id: z.uuid(),
    source: z.literal("desktop"),
    capability: z.literal("desktop:control"),
    approval: z.literal("policy"),
    expiresAtMillis: z.number().int().nonnegative(),
    reconnectSeconds: z.number().int().min(0).max(86400).optional(),
    iceServers: z
      .array(
        z
          .object({
            urls: z
              .array(
                z
                  .string()
                  .max(2048)
                  .regex(/^(stun|turn|turns):\S+$/),
              )
              .min(1)
              .max(8),
            username: z.string().max(1024).optional(),
            credential: z.string().max(1024).optional(),
          })
          .strict(),
      )
      .max(8),
    iceTransportPolicy: z.enum(["all", "relay"]),
  })
  .strict();
export const signinSignalCandidate = z
  .object({
    type: z.literal("candidate"),
    candidate: z.string().max(2048),
    sdpMid: z.string().max(32).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(16).nullable().optional(),
  })
  .strict();
export const signinViewerSignal = z.discriminatedUnion("type", [
  signinSignalReady,
  z
    .object({
      type: z.literal("peer-ready"),
      scope: z.literal("windows:sign-in"),
    })
    .strict(),
  z
    .object({ type: z.literal("offer"), sdp: z.string().min(1).max(32768) })
    .strict(),
  signinSignalCandidate,
]);
export const signinDisplay = z
  .object({
    type: z.literal("display"),
    version: z.literal(1),
    ...signinContext,
    id: z.literal("signin-primary"),
    width: z.number().int().min(1).max(32768),
    height: z.number().int().min(1).max(32768),
    encodedWidth: z
      .number()
      .int()
      .min(2)
      .max(1920)
      .refine((v) => v % 2 === 0),
    encodedHeight: z
      .number()
      .int()
      .min(2)
      .max(1080)
      .refine((v) => v % 2 === 0),
    cursorComposited: z.literal(true),
  })
  .strict();
export type SignInReady = z.infer<typeof signinSignalReady>;
export type SignInContext = Pick<
  SignInReady,
  "leaseId" | "instanceId" | "consoleSessionId"
>;
export const signinAuthorityState = z
  .object({
    enabled: z.boolean(),
    state: z.enum(["unavailable", "sign-in", "signed-in"]),
    endpointReady: z.boolean(),
    connectable: z.boolean(),
    // Locked, showing the lock-screen picture: a viewer may ask for the password prompt.
    wakeable: z.boolean().optional(),
  })
  .strict();
