import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  base64url,
  delegationBytes,
  sdpFingerprint,
  signDelegation,
  signStatement,
  verifyHostProof,
  type HostProof,
} from "../src/peer-identity.js";

const vector = JSON.parse(
  readFileSync(
    new URL("../test-vectors/peer-chain-v1.json", import.meta.url),
    "utf8",
  ),
);
const machineKey = Uint8Array.from(
  Buffer.from(vector.machinePublicKeyHex, "hex"),
);
const SESSION = vector.delegation.sessionId as string;
const proof: HostProof = {
  delegation: vector.delegation,
  statement: vector.statement,
};
const check = (over: Partial<Parameters<typeof verifyHostProof>[0]> = {}) =>
  verifyHostProof({
    machineKey,
    sessionId: SESSION,
    generation: vector.statement.generation,
    sdp: vector.sdp,
    proof,
    nowMs: vector.nowMs,
    ...over,
  });

async function keyFromSeed(seedHex: string) {
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
    ...Buffer.from(seedHex, "hex"),
  ]);
  return crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
}

test("the chain in the shared vector verifies, and the bytes are the ones Rust also builds", async () => {
  assert.deepEqual(await check(), { ok: true });
  assert.equal(
    new TextDecoder().decode(delegationBytes(vector.delegation)),
    vector.delegationText,
  );
  assert.equal(sdpFingerprint(vector.sdp), vector.sdpFingerprint);
  const machine = await keyFromSeed(vector.machineSeedHex);
  assert.equal(
    await signDelegation(machine, vector.delegation),
    vector.delegation.signature,
  );
});

test("an offer with another fingerprint in its SDP is refused: a relay cannot swap the media key", async () => {
  const swapped = (vector.sdp as string)
    .replaceAll("05:10:1B", "06:10:1B")
    .replaceAll("05:10:1b", "06:10:1b");
  assert.deepEqual(await check({ sdp: swapped }), {
    ok: false,
    problem: "wrong-signature",
  });
});

test("no fingerprint, or media sections that disagree, is refused", async () => {
  const none = (vector.sdp as string)
    .split("\r\n")
    .filter((line) => !line.startsWith("a=fingerprint"))
    .join("\r\n");
  assert.deepEqual(await check({ sdp: none }), {
    ok: false,
    problem: "no-fingerprint",
  });
  const two = (vector.sdp as string).replace(
    /a=fingerprint:sha-256 [0-9a-f:]+\r\n$/i,
    "a=fingerprint:sha-256 " + Array(32).fill("AA").join(":") + "\r\n",
  );
  assert.equal(sdpFingerprint(two), null);
  assert.deepEqual(await check({ sdp: two }), {
    ok: false,
    problem: "no-fingerprint",
  });
  assert.equal(sdpFingerprint("a=fingerprint:sha-1 AA:BB\r\n"), null);
});

test("another computer's key, another session or a replayed generation does not pass", async () => {
  const other = Uint8Array.from(machineKey);
  other[0] ^= 1;
  assert.deepEqual(await check({ machineKey: other }), {
    ok: false,
    problem: "wrong-key",
  });
  assert.deepEqual(
    await check({ sessionId: "1f8fad5b-d9cb-469f-a165-70867728950e" }),
    { ok: false, problem: "wrong-session" },
  );
  assert.deepEqual(
    await check({ generation: vector.statement.generation + 1 }),
    {
      ok: false,
      problem: "wrong-signature",
    },
  );
});

test("a relay that holds a valid delegation but not the session key cannot sign for it", async () => {
  // The attacker keeps the real delegation and signs its own fingerprint with a key of its own.
  const attacker = await keyFromSeed("11".repeat(32));
  const fingerprint = "sha-256 " + Array(32).fill("EE").join(":");
  const forged = await signStatement(attacker, {
    sessionId: SESSION,
    generation: vector.statement.generation,
    role: "host",
    fingerprint,
    nonce: vector.statement.nonce,
    expiresAtMs: vector.statement.expiresAtMs,
  });
  const sdp = `v=0\r\na=fingerprint:${fingerprint}\r\n`;
  assert.deepEqual(
    await check({
      sdp,
      proof: {
        delegation: vector.delegation,
        statement: { ...vector.statement, signature: forged },
      },
    }),
    { ok: false, problem: "wrong-signature" },
  );
  // And a delegation the attacker signed itself fails against the pinned machine key.
  const delegation = {
    sessionId: SESSION,
    sessionKey: base64url(new Uint8Array(32).fill(3)),
    expiresAtMs: vector.delegation.expiresAtMs,
  };
  const self = await signDelegation(attacker, delegation);
  assert.deepEqual(
    await check({
      proof: {
        delegation: { ...delegation, signature: self },
        statement: vector.statement,
      },
    }),
    { ok: false, problem: "wrong-key" },
  );
});

test("expired delegations and statements are refused, and so is an absurdly long delegation", async () => {
  assert.deepEqual(
    await check({ nowMs: vector.delegation.expiresAtMs + 120_000 }),
    {
      ok: false,
      problem: "expired",
    },
  );
  assert.deepEqual(
    await check({ nowMs: vector.statement.expiresAtMs + 120_000 }),
    {
      ok: false,
      problem: "expired",
    },
  );
  // A computer whose clock is a minute off still verifies.
  assert.deepEqual(
    await check({ nowMs: vector.statement.expiresAtMs + 60_000 }),
    {
      ok: true,
    },
  );
  assert.deepEqual(
    await check({ nowMs: vector.delegation.expiresAtMs - 14 * 3_600_000 }),
    { ok: false, problem: "expired" },
  );
});
