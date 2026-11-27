import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkPin,
  confirmChange,
  fromBase64url,
  keyFingerprint,
  signStatement,
  statementBytes,
  statementWellFormed,
  verifyStatement,
  type PeerStatement,
  type PinStore,
} from "../src/peer-identity.js";

const vector = JSON.parse(
  readFileSync(
    new URL("../test-vectors/peer-statement-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  seedHex: string;
  publicKeyHex: string;
  keyFingerprint: string;
  statement: PeerStatement;
  statementText: string;
  signature: string;
};
const publicKey = Uint8Array.from(Buffer.from(vector.publicKeyHex, "hex"));
const NOW = vector.statement.expiresAtMs - 30_000;

async function privateKey() {
  const pkcs8 = new Uint8Array([
    0x30,
    0x2e,
    0x02,
    0x01,
    0x00,
    0x30,
    0x05,
    0x06,
    0x03,
    0x2b,
    0x65,
    0x70,
    0x04,
    0x22,
    0x04,
    0x20,
    ...Buffer.from(vector.seedHex, "hex"),
  ]);
  return crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]);
}

test("the signed bytes and the signature match the shared vector the Rust side also checks", async () => {
  assert.equal(
    new TextDecoder().decode(statementBytes(vector.statement)),
    vector.statementText,
  );
  assert.equal(
    await signStatement(await privateKey(), vector.statement),
    vector.signature,
  );
  assert.deepEqual(
    await verifyStatement(publicKey, vector.statement, vector.signature, NOW),
    { ok: true },
  );
  assert.equal(await keyFingerprint(publicKey), vector.keyFingerprint);
});

test("any changed field, a swapped key or a damaged signature is refused", async () => {
  const bad = async (
    change: Partial<PeerStatement>,
    problem: string,
    key = publicKey,
    signature = vector.signature,
  ) => {
    const result = await verifyStatement(
      key,
      { ...vector.statement, ...change },
      signature,
      NOW,
    );
    assert.deepEqual(result, { ok: false, problem }, JSON.stringify(change));
  };
  await bad({ generation: 4 }, "wrong-signature");
  await bad({ role: "viewer" }, "wrong-signature");
  await bad({ nonce: "AAAAAAAAAAAAAAAAAAAAAA" }, "wrong-signature");
  await bad(
    { sessionId: "1f8fad5b-d9cb-469f-a165-70867728950e" },
    "wrong-signature",
  );
  await bad(
    { fingerprint: vector.statement.fingerprint.replace("01:08", "02:08") },
    "wrong-signature",
  );
  // Another computer's key cannot vouch for this statement.
  const other = Uint8Array.from(publicKey);
  other[0] ^= 1;
  await bad({}, "wrong-signature", other);
  // A flipped bit in the signature.
  const raw = fromBase64url(vector.signature)!;
  raw[10] ^= 1;
  await bad(
    {},
    "wrong-signature",
    publicKey,
    Buffer.from(raw).toString("base64url"),
  );
  await bad({}, "malformed", publicKey, "not a signature!");
  await bad({}, "malformed", publicKey, "AAAA");
});

test("an expired statement, or one that claims to last too long, is refused", async () => {
  const at = (now: number) =>
    verifyStatement(publicKey, vector.statement, vector.signature, now);
  assert.deepEqual(await at(vector.statement.expiresAtMs), {
    ok: false,
    problem: "expired",
  });
  assert.deepEqual(await at(vector.statement.expiresAtMs + 1), {
    ok: false,
    problem: "expired",
  });
  assert.deepEqual(await at(vector.statement.expiresAtMs - 61_000), {
    ok: false,
    problem: "expired",
  });
  assert.deepEqual(await at(vector.statement.expiresAtMs - 59_000), {
    ok: true,
  });
});

test("fields that could change where one line ends are never accepted", () => {
  const good = vector.statement;
  assert.ok(statementWellFormed(good));
  for (const change of [
    { nonce: "AAAAAAAAAAAAAAAA\nrole:viewer" },
    { fingerprint: good.fingerprint + "\nrole:viewer" },
    { sessionId: good.sessionId + "\n" },
    { generation: -1 },
    { generation: 1.5 },
    { generation: 2000 },
    { expiresAtMs: 0 },
    { role: "root" as never },
    { nonce: "short" },
    { fingerprint: "sha-1 00:11" },
  ]) {
    assert.ok(
      !statementWellFormed({ ...good, ...change }),
      JSON.stringify(change),
    );
    assert.throws(() => statementBytes({ ...good, ...change }), /malformed/);
  }
});

function memory(): PinStore & { all: Map<string, string> } {
  const all = new Map<string, string>();
  return {
    all,
    get: (id) => all.get(id),
    set: (id, value) => void all.set(id, value),
  };
}

test("the first key is pinned, the same key matches, a different key is reported and never taken silently", () => {
  const store = memory();
  assert.deepEqual(checkPin(store, "m1", "AAAA-BBBB"), {
    state: "first-use",
    fingerprint: "AAAA-BBBB",
  });
  assert.deepEqual(checkPin(store, "m1", "AAAA-BBBB"), {
    state: "match",
    fingerprint: "AAAA-BBBB",
  });
  assert.deepEqual(checkPin(store, "m1", "CCCC-DDDD"), {
    state: "changed",
    fingerprint: "CCCC-DDDD",
    pinned: "AAAA-BBBB",
  });
  // Still pinned to the old key until the person confirms.
  assert.equal(store.get("m1"), "AAAA-BBBB");
  assert.equal(checkPin(store, "m1", "CCCC-DDDD").state, "changed");
  confirmChange(store, "m1", "CCCC-DDDD");
  assert.equal(checkPin(store, "m1", "CCCC-DDDD").state, "match");
  // Another computer has its own pin.
  assert.equal(checkPin(store, "m2", "CCCC-DDDD").state, "first-use");
});

test("the key fingerprint is six groups of four letters and differs per key", async () => {
  const one = await keyFingerprint(publicKey);
  assert.match(one, /^([A-Z2-7]{4}-){5}[A-Z2-7]{4}$/);
  const other = Uint8Array.from(publicKey);
  other[31] ^= 1;
  assert.notEqual(await keyFingerprint(other), one);
});
