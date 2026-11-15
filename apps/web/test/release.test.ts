import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRelease } from "../src/release.js";

const published = {
  version: "development-abcdef12",
  commit: "abcdef12",
  file: "BeaconRemoteDevelopment-abcdef12.zip",
  bytes: 1048576,
  sha256: "a".repeat(64),
  publishedAt: "2026-11-11T10:00:00Z",
};

test("downloads accept published artifacts without trusting arbitrary manifest links or sizes", () => {
  assert.equal(parseRelease(published)?.file, published.file);
  for (const file of [
    "../host.zip",
    "https://example.com/host.zip",
    "host.zip?redirect=x",
    "host.exe",
  ])
    assert.equal(parseRelease({ ...published, file }), null);
  for (const bytes of [-1, 0, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(parseRelease({ ...published, bytes }), null);
  assert.equal(parseRelease({ ...published, publishedAt: "not a date" }), null);
  assert.equal(parseRelease({ ...published, sha256: "unknown" }), null);
});

test("malformed optional platforms and trust data cannot become actions or certificate claims", () => {
  const installer = {
    file: "BeaconRemoteSetup-abcdef12.exe",
    bytes: 12345,
    sha256: "b".repeat(64),
  };
  const android = {
    file: "BeaconRemoteHost-abcdef12.apk",
    bytes: 67890,
    sha256: "c".repeat(64),
    signer: "d".repeat(64),
  };
  const signing = {
    certificate: "beacon-remote-signing.cer",
    sha256: "e".repeat(64),
    script: "Trust-BeaconRemote.ps1",
    scriptSha256: "f".repeat(64),
    notAfter: "2027-11-11T00:00:00Z",
  };
  assert.deepEqual(
    parseRelease({ ...published, installer, android, signing }),
    { ...published, installer, android, signing },
  );
  const malformed = parseRelease({
    ...published,
    installer: { ...installer, file: "../setup.exe" },
    android: { ...android, signer: "invalid" },
    signing: { ...signing, script: "https://example.com/trust.ps1" },
  });
  assert.equal(malformed?.installer, undefined);
  assert.equal(malformed?.android?.signer, undefined);
  assert.equal(malformed?.signing, undefined);
});
