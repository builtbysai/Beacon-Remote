// Read-only probes: never authenticate, pair, start capture or change services.
export const acceptanceOrigin = "https://remote-test.builtbysai.com";

export async function inspectAcceptance(origin = acceptanceOrigin) {
  const probes = await Promise.all(
    [
      ["/ready", 200],
      ["/api/machines", 401],
    ].map(async ([path, expected]) => {
      try {
        const response = await fetch(`${origin}${path}`, {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        return { path, expected, status: response.status };
      } catch {
        return { path, expected, status: null };
      }
    }),
  );
  return {
    ready: probes.every(({ status, expected }) => status === expected),
    probes,
  };
}

export async function requireAcceptanceReady() {
  const result = await inspectAcceptance();
  if (!result.ready) {
    throw new Error(
      "Isolated acceptance backend is unavailable or has unexpected access controls. Check its bounded runtime before launching the fixture or retrying sign-in. No automatic restart was attempted.",
    );
  }
}
