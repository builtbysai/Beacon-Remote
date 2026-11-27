// Peer authentication above signaling (ADR 0061, foundation). A host signs a short statement naming the session, the
// generation, its DTLS fingerprint and the viewer's nonce, with its machine key; the viewer checks it against the key
// it pinned for that computer. The server relays all of this and cannot forge it. The Rust twin is
// crates/remote-core/src/peer_identity.rs; both are tested against packages/protocol/test-vectors/peer-statement-v1.json.
//
// Nothing here enforces anything yet: the hosts do not sign and the viewer does not verify until ADR 0061's later
// steps land. These are the rules both sides will share.

export type PeerRole = "host" | "viewer";

export type PeerStatement = {
  sessionId: string;
  generation: number;
  role: PeerRole;
  /** The DTLS fingerprint as in the SDP: `sha-256 ` then 32 colon-separated uppercase hex bytes. */
  fingerprint: string;
  /** Chosen by the other side, so a signed statement cannot be replayed into another connection. */
  nonce: string;
  /** Milliseconds since 1970; a statement past this is refused. */
  expiresAtMs: number;
};

export type PeerStatementProblem =
  "malformed" | "expired" | "wrong-signature" | "wrong-key";

const SESSION =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT = /^sha-256 ([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
/** A statement is good for one minute at most, so a captured one is of no later use. */
export const MAX_STATEMENT_MS = 60_000;
/**
 * How far apart two clocks may be before a good proof is called expired. Expiry is hygiene (a statement is also bound to
 * one fingerprint), so a wrong clock must not make a real computer look like an impostor, least of all in strict mode.
 */
export const CLOCK_SKEW_MS = 120_000;

/** Whether every field has the exact shape the other side will rebuild; nothing can smuggle in a line break. */
export function statementWellFormed(statement: PeerStatement): boolean {
  return (
    SESSION.test(statement.sessionId) &&
    Number.isSafeInteger(statement.generation) &&
    statement.generation >= 0 &&
    statement.generation <= 1024 &&
    (statement.role === "host" || statement.role === "viewer") &&
    FINGERPRINT.test(statement.fingerprint) &&
    NONCE.test(statement.nonce) &&
    Number.isSafeInteger(statement.expiresAtMs) &&
    statement.expiresAtMs > 0
  );
}

/** The exact bytes that are signed: a version line, then one `name:value` line per field. */
export function statementBytes(statement: PeerStatement): Uint8Array {
  if (!statementWellFormed(statement)) throw new Error("malformed");
  return new TextEncoder().encode(
    [
      "beacon-peer-v1",
      `session:${statement.sessionId}`,
      `generation:${statement.generation}`,
      `role:${statement.role}`,
      `fingerprint:${statement.fingerprint}`,
      `nonce:${statement.nonce}`,
      `expires:${statement.expiresAtMs}`,
    ].join("\n"),
  );
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded =
    text.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

const bytes = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;

export async function signStatement(
  key: CryptoKey,
  statement: PeerStatement,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "Ed25519",
    key,
    bytes(statementBytes(statement)),
  );
  return base64url(new Uint8Array(signature));
}

/**
 * Checks a statement against the key pinned for this computer. `expected` is what this side knows from the
 * connection itself (its own nonce, the session and generation it is in, the fingerprint in the SDP it was given); a
 * statement that differs in any of those is refused even if the signature is good.
 */
export async function verifyStatement(
  publicKey: Uint8Array,
  statement: PeerStatement,
  signature: string,
  nowMs: number,
): Promise<{ ok: true } | { ok: false; problem: PeerStatementProblem }> {
  if (publicKey.length !== 32 || !statementWellFormed(statement))
    return { ok: false, problem: "malformed" };
  if (
    statement.expiresAtMs + CLOCK_SKEW_MS <= nowMs ||
    statement.expiresAtMs - nowMs > MAX_STATEMENT_MS + CLOCK_SKEW_MS
  )
    return { ok: false, problem: "expired" };
  const raw = fromBase64url(signature);
  if (!raw || raw.length !== 64) return { ok: false, problem: "malformed" };
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      bytes(publicKey),
      "Ed25519",
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, problem: "wrong-key" };
  }
  const good = await crypto.subtle.verify(
    "Ed25519",
    key,
    bytes(raw),
    bytes(statementBytes(statement)),
  );
  return good ? { ok: true } : { ok: false, problem: "wrong-signature" };
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A short code a person can compare on two screens: 120 bits of the key's SHA-256 as six groups of four letters. */
export async function keyFingerprint(publicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes(publicKey)),
  );
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest.subarray(0, 15)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

export type PinDecision =
  | { state: "first-use"; fingerprint: string }
  | { state: "match"; fingerprint: string }
  | { state: "changed"; fingerprint: string; pinned: string };

/** Where the browser remembers each computer's key. Only the key's fingerprint is kept, never a secret. */
export type PinStore = {
  get(machineId: string): string | undefined;
  set(machineId: string, fingerprint: string): void;
};

/**
 * Trust on first use. A key that matches the pin is fine, a first key is pinned, and a different key is never
 * accepted here: it is reported as changed and the person decides (ADR 0061, step 3) by confirming it with
 * `confirmChange` after comparing the fingerprints on the computer itself.
 */
export function checkPin(
  store: PinStore,
  machineId: string,
  fingerprint: string,
): PinDecision {
  const pinned = store.get(machineId);
  if (pinned === undefined) {
    store.set(machineId, fingerprint);
    return { state: "first-use", fingerprint };
  }
  return pinned === fingerprint
    ? { state: "match", fingerprint }
    : { state: "changed", fingerprint, pinned };
}

/** Replaces a pin after the person has confirmed the new fingerprint against the computer. */
export function confirmChange(
  store: PinStore,
  machineId: string,
  fingerprint: string,
): void {
  store.set(machineId, fingerprint);
}

// ---- The delegation chain (ADR 0061, integration design) -------------------------------------------------------
// The machine key stays in the host process. For each session the host signs a delegation naming a key it minted for
// that session; the capture helper holds only that key and signs the connection statement with it. A viewer checks the
// chain: the machine key it pinned, then the delegation, then the statement.

export type Delegation = {
  sessionId: string;
  /** The session key's public half, URL-safe base64. */
  sessionKey: string;
  expiresAtMs: number;
};

/** A delegation lasts as long as a session can (twelve hours) and a little more. */
export const MAX_DELEGATION_MS = 13 * 60 * 60 * 1000;

const SESSION_KEY = /^[A-Za-z0-9_-]{43}$/;

export function delegationWellFormed(delegation: Delegation): boolean {
  return (
    SESSION.test(delegation.sessionId) &&
    SESSION_KEY.test(delegation.sessionKey) &&
    Number.isSafeInteger(delegation.expiresAtMs) &&
    delegation.expiresAtMs > 0
  );
}

export function delegationBytes(delegation: Delegation): Uint8Array {
  if (!delegationWellFormed(delegation)) throw new Error("malformed");
  return new TextEncoder().encode(
    [
      "beacon-peer-delegation-v1",
      `session:${delegation.sessionId}`,
      `key:${delegation.sessionKey}`,
      `expires:${delegation.expiresAtMs}`,
    ].join("\n"),
  );
}

export async function signDelegation(
  machineKey: CryptoKey,
  delegation: Delegation,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "Ed25519",
    machineKey,
    bytes(delegationBytes(delegation)),
  );
  return base64url(new Uint8Array(signature));
}

/** What a host sends beside an offer: the delegation, and the statement signed with the session key. */
export type HostProof = {
  delegation: Delegation & { signature: string };
  statement: { nonce: string; expiresAtMs: number; signature: string };
};

/** The DTLS fingerprint in an SDP, normalised; null if there is none or the media sections disagree. */
export function sdpFingerprint(sdp: string): string | null {
  const found = new Set<string>();
  for (const line of sdp.split(/\r?\n/)) {
    const match = /^a=fingerprint:(sha-256) ([0-9A-Fa-f:]+)\s*$/.exec(line);
    if (match) found.add(`sha-256 ${match[2]!.toUpperCase()}`);
    else if (line.startsWith("a=fingerprint:")) return null;
  }
  return found.size === 1 ? [...found][0]! : null;
}

export type ChainProblem =
  PeerStatementProblem | "no-fingerprint" | "wrong-session";

/**
 * Checks that an offer really comes from the pinned computer: the delegation is signed by the machine key and names this
 * session, the statement is signed by the delegated key, and the statement's fingerprint is the one in this SDP.
 */
export async function verifyHostProof(input: {
  machineKey: Uint8Array;
  sessionId: string;
  generation: number;
  sdp: string;
  proof: HostProof;
  nowMs: number;
}): Promise<{ ok: true } | { ok: false; problem: ChainProblem }> {
  const { delegation, statement } = input.proof;
  if (!delegationWellFormed(delegation))
    return { ok: false, problem: "malformed" };
  if (delegation.sessionId !== input.sessionId)
    return { ok: false, problem: "wrong-session" };
  if (
    delegation.expiresAtMs + CLOCK_SKEW_MS <= input.nowMs ||
    delegation.expiresAtMs - input.nowMs > MAX_DELEGATION_MS + CLOCK_SKEW_MS
  )
    return { ok: false, problem: "expired" };
  const signature = fromBase64url(delegation.signature);
  const sessionKey = fromBase64url(delegation.sessionKey);
  if (
    !signature ||
    signature.length !== 64 ||
    !sessionKey ||
    sessionKey.length !== 32
  )
    return { ok: false, problem: "malformed" };
  let machine: CryptoKey;
  try {
    machine = await crypto.subtle.importKey(
      "raw",
      bytes(input.machineKey),
      "Ed25519",
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, problem: "wrong-key" };
  }
  const delegated = await crypto.subtle.verify(
    "Ed25519",
    machine,
    bytes(signature),
    bytes(delegationBytes(delegation)),
  );
  if (!delegated) return { ok: false, problem: "wrong-key" };
  const fingerprint = sdpFingerprint(input.sdp);
  if (!fingerprint) return { ok: false, problem: "no-fingerprint" };
  return verifyStatement(
    sessionKey,
    {
      sessionId: input.sessionId,
      generation: input.generation,
      role: "host",
      fingerprint,
      nonce: statement.nonce,
      expiresAtMs: statement.expiresAtMs,
    },
    statement.signature,
    input.nowMs,
  );
}
