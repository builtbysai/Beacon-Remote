import {
  checkPin,
  fromBase64url,
  keyFingerprint,
  verifyHostProof,
  type HostProof,
  type PinStore,
} from "@beacon-remote/protocol";

// The viewer's side of peer authentication (ADR 0061). Given an offer and the proof a host sent beside it, this says
// whether the offer really came from the computer whose key this browser pinned. It is advisory unless the person
// turned strict mode on: an unsigned, mismatched or changed identity is shown clearly and the connection still goes
// ahead, because older hosts do not sign yet.

export type IdentityVerdict =
  /** The proof checks out against the pinned key. `firstUse` means this browser had not seen the computer before. */
  | { state: "verified"; code: string; firstUse: boolean }
  /** The host sent no proof (an older host). */
  | { state: "unsigned" }
  /** The server did not give a key to pin, so there is nothing to check against. */
  | { state: "no-key" }
  /** The computer's key is not the one pinned for it. Never accepted silently. */
  | { state: "changed"; code: string; pinned: string }
  /** A proof was sent and did not verify. */
  | { state: "failed"; problem: string };

export async function judgeOffer(input: {
  store: PinStore;
  machineId: string;
  /** The key the server lists for this computer, URL-safe base64. */
  identityKey: string | undefined;
  sessionId: string;
  generation: number;
  sdp: string;
  proof: HostProof | undefined;
  nowMs: number;
}): Promise<IdentityVerdict> {
  if (!input.proof) return { state: "unsigned" };
  const key = input.identityKey ? fromBase64url(input.identityKey) : null;
  if (!key || key.length !== 32) return { state: "no-key" };
  const code = await keyFingerprint(key);
  // A pinned key that differs is reported and never replaced here. A first key is remembered only once its proof has
  // checked out, so a proof that fails pins nothing.
  const pinned = input.store.get(input.machineId);
  if (pinned !== undefined && pinned !== code)
    return { state: "changed", code, pinned };
  const result = await verifyHostProof({
    machineKey: key,
    sessionId: input.sessionId,
    generation: input.generation,
    sdp: input.sdp,
    proof: input.proof,
    nowMs: input.nowMs,
  });
  if (!result.ok) return { state: "failed", problem: result.problem };
  const firstUse =
    checkPin(input.store, input.machineId, code).state === "first-use";
  return { state: "verified", code, firstUse };
}

const PINS = "beacon-remote-computer-keys";
const STRICT = "beacon-remote-strict-identity";

/** Pins kept in this browser (only key codes, never a secret). Works without storage by remembering for the page. */
export function browserPinStore(
  storage: Storage | undefined = safeStorage(),
): PinStore {
  const memory = new Map<string, string>();
  const read = (): Record<string, string> => {
    try {
      const parsed = JSON.parse(storage?.getItem(PINS) ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  };
  return {
    get: (machineId) => (storage ? read()[machineId] : memory.get(machineId)),
    set: (machineId, code) => {
      if (!storage) return void memory.set(machineId, code);
      try {
        storage.setItem(PINS, JSON.stringify({ ...read(), [machineId]: code }));
      } catch {
        memory.set(machineId, code);
      }
    },
  };
}

/** Strict mode refuses anything but a verified computer. Off by default until the hosts all sign. */
export function strictIdentity(
  storage: Storage | undefined = safeStorage(),
): boolean {
  try {
    return storage?.getItem(STRICT) === "1";
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The words shown to the person for a verdict, or null when nothing needs saying. */
export function identityNotice(verdict: IdentityVerdict): string | null {
  switch (verdict.state) {
    case "verified":
      return verdict.firstUse
        ? `Computer identity checked. Key ${verdict.code} is now remembered for this computer; compare it with the code in the Beacon Remote window on the computer.`
        : null;
    case "unsigned":
      return "This computer's app does not prove who it is yet. Update it for the strongest protection.";
    case "no-key":
      return "The server gave no identity key for this computer, so it could not be checked.";
    case "changed":
      return `This computer's identity key changed (was ${verdict.pinned}, now ${verdict.code}). Check the code in the Beacon Remote window on the computer before you trust this connection.`;
    case "failed":
      return "This computer could not prove who it is. The connection may not be from the computer you chose.";
  }
}
