import { useEffect, useState } from "react";

type Artifact = { file: string; bytes: number; sha256: string };
export type Release = Artifact & {
  version: string;
  commit: string;
  publishedAt: string;
  installer?: Artifact;
  android?: Artifact & { signer?: string };
  signing?: {
    certificate: string;
    sha256: string;
    script: string;
    scriptSha256: string;
    notAfter: string;
  };
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function artifact(value: unknown, name: RegExp): Artifact | undefined {
  const item = object(value);
  return item &&
    typeof item.file === "string" &&
    name.test(item.file) &&
    hash(item.sha256) &&
    typeof item.bytes === "number" &&
    Number.isSafeInteger(item.bytes) &&
    item.bytes > 0
    ? { file: item.file, bytes: item.bytes, sha256: item.sha256 }
    : undefined;
}

// Only local published filenames become links. Optional invalid packages never
// turn into download actions or trust claims.
export function parseRelease(value: unknown): Release | null {
  const body = object(value);
  const zip = artifact(value, /^[A-Za-z0-9._-]+\.zip$/);
  if (
    !body ||
    !zip ||
    typeof body.version !== "string" ||
    !body.version.trim() ||
    body.version.length > 100 ||
    typeof body.commit !== "string" ||
    !/^[a-f0-9]{8,40}$/.test(body.commit) ||
    typeof body.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(body.publishedAt))
  )
    return null;
  const installer = artifact(
    body.installer,
    /^BeaconRemoteSetup-[a-f0-9]{8,40}\.exe$/,
  );
  const android = artifact(body.android, /^BeaconRemoteHost-[a-f0-9]{8}\.apk$/);
  const androidSigner = object(body.android)?.signer;
  const candidate = object(body.signing);
  const signing =
    candidate &&
    candidate.certificate === "beacon-remote-signing.cer" &&
    candidate.script === "Trust-BeaconRemote.ps1" &&
    hash(candidate.sha256) &&
    hash(candidate.scriptSha256) &&
    typeof candidate.notAfter === "string" &&
    Number.isFinite(Date.parse(candidate.notAfter))
      ? {
          certificate: candidate.certificate,
          script: candidate.script,
          sha256: candidate.sha256,
          scriptSha256: candidate.scriptSha256,
          notAfter: candidate.notAfter,
        }
      : undefined;
  return {
    ...zip,
    version: body.version,
    commit: body.commit,
    publishedAt: body.publishedAt,
    installer,
    android: android
      ? { ...android, signer: hash(androidSigner) ? androidSigner : undefined }
      : undefined,
    signing,
  };
}

export function useReleaseStatus() {
  const [release, setRelease] = useState<Release | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRelease(undefined);
    setFailed(false);
    void fetch("/downloads/manifest.json", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Release unavailable");
        const result = parseRelease(await response.json());
        if (!result) throw new Error("Invalid release manifest");
        return result;
      })
      .then((result) => {
        if (!controller.signal.aborted) setRelease(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setRelease(null);
        }
      });
    return () => controller.abort();
  }, [attempt]);
  return {
    release,
    failed,
    retry: () => setAttempt((previous) => previous + 1),
  };
}

export function useRelease() {
  return useReleaseStatus().release;
}
