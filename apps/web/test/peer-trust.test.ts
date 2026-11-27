import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { base64url, type HostProof } from "@beacon-remote/protocol";
import {
  browserPinStore,
  identityNotice,
  judgeOffer,
  setStrictIdentity,
  strictIdentity,
  trustChangedKey,
} from "../src/peer-trust.js";

const vector = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/protocol/test-vectors/peer-chain-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const identityKey = base64url(
  Uint8Array.from(Buffer.from(vector.machinePublicHex, "hex")),
);
const proof: HostProof = {
  delegation: {
    sessionId: vector.delegation.sessionId,
    sessionKey: vector.delegation.sessionPublic,
    expiresAtMs: vector.delegation.expiresAtMs,
    signature: vector.delegation.signature,
  },
  statement: vector.statement,
};
const base = {
  machineId: "machine-1",
  identityKey,
  sessionId: vector.delegation.sessionId as string,
  generation: vector.statement.generation as number,
  sdp: vector.sdp as string,
  proof,
  nowMs: vector.nowMs as number,
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

test("a first connection to a signed computer verifies and remembers its key", async () => {
  const store = browserPinStore(memoryStorage());
  const verdict = await judgeOffer({ ...base, store });
  assert.equal(verdict.state, "verified");
  assert.equal(verdict.state === "verified" && verdict.firstUse, true);
  // The next time it matches the pin and needs no words.
  const again = await judgeOffer({ ...base, store });
  assert.equal(again.state === "verified" && again.firstUse, false);
  assert.equal(identityNotice(again), null);
  assert.match(identityNotice(verdict)!, /Key [A-Z2-7-]+ is now remembered/);
});

test("a host that sends no proof is reported as unsigned, and nothing is pinned", async () => {
  const store = browserPinStore(memoryStorage());
  const verdict = await judgeOffer({ ...base, store, proof: undefined });
  assert.deepEqual(verdict, { state: "unsigned" });
  assert.equal(store.get("machine-1"), undefined);
  assert.match(identityNotice(verdict)!, /does not prove who it is yet/);
});

test("without a key from the server there is nothing to check against", async () => {
  const store = browserPinStore(memoryStorage());
  for (const key of [
    undefined,
    "",
    "not-a-key",
    base64url(new Uint8Array(8)),
  ]) {
    const verdict = await judgeOffer({ ...base, store, identityKey: key });
    assert.deepEqual(verdict, { state: "no-key" }, String(key));
  }
});

test("a different key from the one pinned is reported and never replaces the pin", async () => {
  const storage = memoryStorage();
  const store = browserPinStore(storage);
  await judgeOffer({ ...base, store });
  const pinned = store.get("machine-1");
  const other = Uint8Array.from(Buffer.from(vector.machinePublicHex, "hex"));
  other[0]! ^= 1;
  const verdict = await judgeOffer({
    ...base,
    store,
    identityKey: base64url(other),
  });
  assert.equal(verdict.state, "changed");
  assert.equal(verdict.state === "changed" && verdict.pinned, pinned);
  assert.equal(store.get("machine-1"), pinned);
  assert.match(identityNotice(verdict)!, /identity key changed/);
  // Only the person's explicit choice replaces the pin, and only with the key that was reported.
  assert.equal(trustChangedKey(store, "machine-1", verdict), true);
  assert.equal(store.get("machine-1"), verdict.code);
  const unsigned = { state: "unsigned" } as const;
  assert.equal(trustChangedKey(store, "machine-1", unsigned), false);
  assert.equal(store.get("machine-1"), verdict.code);
});

test("a proof that does not verify is reported and pins nothing", async () => {
  const store = browserPinStore(memoryStorage());
  const tampered = (vector.sdp as string)
    .replaceAll("05:10:1B", "06:10:1B")
    .replaceAll("05:10:1b", "06:10:1b");
  const verdict = await judgeOffer({ ...base, store, sdp: tampered });
  assert.deepEqual(verdict, { state: "failed", problem: "wrong-signature" });
  assert.equal(store.get("machine-1"), undefined);
  assert.match(identityNotice(verdict)!, /could not prove who it is/);
  // Another computer's session, or an expired proof, fails the same way.
  assert.equal(
    (
      await judgeOffer({
        ...base,
        store,
        sessionId: "1f8fad5b-d9cb-469f-a165-70867728950e",
      })
    ).state,
    "failed",
  );
  assert.equal(
    (
      await judgeOffer({
        ...base,
        store,
        nowMs: vector.delegation.expiresAtMs + 130_000,
      })
    ).state,
    "failed",
  );
});

test("pins survive in browser storage, damaged storage is ignored, and strict mode is off unless set", () => {
  const storage = memoryStorage();
  browserPinStore(storage).set("m", "AAAA-BBBB");
  assert.equal(browserPinStore(storage).get("m"), "AAAA-BBBB");
  assert.equal(
    browserPinStore(
      memoryStorage({ "beacon-remote-computer-keys": "{not json" }),
    ).get("m"),
    undefined,
  );
  assert.equal(
    browserPinStore(
      memoryStorage({ "beacon-remote-computer-keys": "[1]" }),
    ).get("m"),
    undefined,
  );
  // With no storage at all the pin lasts for the page.
  const none = browserPinStore(undefined as never);
  none.set("m", "CCCC-DDDD");
  assert.equal(none.get("m"), "CCCC-DDDD");
  assert.equal(strictIdentity(memoryStorage()), false);
  assert.equal(
    strictIdentity(memoryStorage({ "beacon-remote-strict-identity": "1" })),
    true,
  );
});

test("strict mode can be turned on and off and says when it could not be kept", () => {
  const storage = memoryStorage();
  assert.equal(strictIdentity(storage), false);
  assert.equal(setStrictIdentity(true, storage), true);
  assert.equal(strictIdentity(storage), true);
  assert.equal(setStrictIdentity(false, storage), true);
  assert.equal(strictIdentity(storage), false);
  assert.equal(setStrictIdentity(true, undefined), false);
});
