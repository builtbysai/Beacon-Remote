// Generated with the previously shipped @node-rs/argon2 2.0.2 defaults.
// Keep this fixture stable: generating both sides with the new package misses
// incompatibilities that would lock existing accounts out after an upgrade.
import test from "node:test";
import assert from "node:assert/strict";
import { hash, verify } from "@node-rs/argon2";
const password =
  "Historical hash compatibility fixture; never an account credential";
const stored =
  "$argon2id$v=19$m=19456,t=2,p=1$AqBL+uauhbo3AxBgLO0l3A$HnPkcaf2K/a3fvlOB98bsTujjozzxx1SFalUbTu9IlI";
test("password hashes from the prior Argon2 backend remain usable after upgrade", async () => {
  assert.equal(await verify(stored, password), true);
  assert.equal(await verify(stored, password + "wrong"), false);
  const current = await hash(password);
  assert.equal(await verify(current, password), true);
  assert.equal(await verify(current, password + "wrong"), false);
});
