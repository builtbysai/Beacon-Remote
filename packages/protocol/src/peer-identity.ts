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
    statement.expiresAtMs <= nowMs ||
    statement.expiresAtMs - nowMs > MAX_STATEMENT_MS
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
