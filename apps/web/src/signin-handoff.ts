import {
  signinAuthorityState,
  signinHandoffStatus,
  signinDesktopGrant,
  type SignInContext,
} from "@beacon-remote/protocol";
import { api, ApiError } from "./api.js";
import type { ViewGrant } from "./LiveView.js";

export type HandoffIO = {
  request: (
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  now: () => number;
  wait: (signal: AbortSignal) => Promise<void>;
};
const defaults: HandoffIO = {
  request: (path, body, signal) => api(path, body, signal),
  now: () => performance.now(),
  wait: (signal) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 500);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }),
};
/** Whether the computer reports a signed-in console now (its own sign-in state, not a guess from timing). */
export async function signedIn(machine: string, io = defaults) {
  try {
    const state = signinAuthorityState.safeParse(
      await io.request(
        `machines/${machine}/signin-authority`,
        undefined,
        AbortSignal.timeout(3000),
      ),
    );
    return state.success && state.data.state === "signed-in";
  } catch {
    return false;
  }
}

/**
 * The ordinary trusted desktop session after Windows signed in, for when the sign-in service could not hand its own
 * connection over. The desktop host needs a few seconds after sign-in to come online, so an unavailable computer is
 * asked again until `windowMs` ends; being signed out of Beacon or refused access ends it at once.
 */
export async function desktopAfterSignIn(
  machine: string,
  signal: AbortSignal,
  io = defaults,
  windowMs = 45_000,
): Promise<ViewGrant> {
  const started = io.now();
  for (;;) {
    signal.throwIfAborted();
    try {
      const grant = await io.request(
        `machines/${machine}/sessions`,
        { source: "desktop", capability: "desktop:control" },
        AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      );
      if (
        grant &&
        typeof grant === "object" &&
        "id" in grant &&
        typeof grant.id === "string"
      )
        return grant as ViewGrant;
      throw new Error("Unexpected desktop grant");
    } catch (error) {
      signal.throwIfAborted();
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      )
        throw error;
      if (io.now() - started >= windowMs) throw error;
    }
    await io.wait(signal);
    await io.wait(signal);
    await io.wait(signal);
  }
}

export async function cancelSignInHandoff(
  lease: string,
  desktop?: string,
  io = defaults,
) {
  await Promise.allSettled([
    io.request(`signin/leases/${lease}/stop`, {}, AbortSignal.timeout(3000)),
    ...(desktop
      ? [io.request(`sessions/${desktop}/stop`, {}, AbortSignal.timeout(3000))]
      : []),
  ]);
}
export async function handoffDesktop(
  machine: string,
  scope: SignInContext,
  signal: AbortSignal,
  notice: (text: string) => void,
  io = defaults,
): Promise<ViewGrant> {
  const started = io.now();
  let desktop: string | undefined;
  const current = () => {
    signal.throwIfAborted();
    if (io.now() < started || io.now() >= started + 30000)
      throw new Error("Desktop handoff timed out");
  };
  try {
    notice("Signing in… your desktop opens here next.");
    while (true) {
      current();
      const raw = await io.request(
        `signin/leases/${scope.leaseId}/handoff`,
        undefined,
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      );
      current();
      const state = signinHandoffStatus.parse(raw);
      if (state.state === "pending") {
        await io.wait(signal);
        continue;
      }
      if (
        state.machineId !== machine ||
        state.leaseId !== scope.leaseId ||
        state.instanceId !== scope.instanceId ||
        state.consoleSessionId !== scope.consoleSessionId ||
        state.hostContext.consoleSessionId !== scope.consoleSessionId
      )
        throw new Error("Desktop handoff context changed");
      notice("Opening your desktop…");
      const issued = await io.request(
        `machines/${machine}/sessions`,
        {
          source: "desktop",
          capability: "desktop:control",
          requirePolicy: true,
          hostContext: state.hostContext,
          signinLeaseId: scope.leaseId,
        },
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      );
      if (
        issued &&
        typeof issued === "object" &&
        "id" in issued &&
        typeof issued.id === "string" &&
        /^[0-9a-f-]{36}$/i.test(issued.id)
      )
        desktop = issued.id;
      const grant = signinDesktopGrant.parse(issued);
      current();
      return grant;
    }
  } catch (error) {
    await cancelSignInHandoff(scope.leaseId, desktop, io);
    throw error;
  }
}
