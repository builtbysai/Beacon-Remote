import { signinAuthorityState } from "@beacon-remote/protocol";
import { api } from "./api.js";

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Brings a locked computer's password prompt up (asking once, when the endpoint is on the lock-screen picture) and
 * resolves true when the sign-in screen can be opened. False when the computer is signed in, unreachable or the
 * prompt did not come up in time.
 */
export async function wakeSignIn(
  machineId: string,
  signal: AbortSignal,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let asked = false;
  while (Date.now() < deadline && !signal.aborted) {
    let raw: unknown;
    try {
      raw = await api<unknown>(
        `machines/${machineId}/signin-authority`,
        undefined,
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      );
    } catch {
      raw = null;
    }
    const state = signinAuthorityState.safeParse(raw);
    if (state.success) {
      if (!state.data.enabled || state.data.state === "signed-in") return false;
      if (state.data.endpointReady && state.data.connectable) return true;
      if (!asked && state.data.wakeable) {
        try {
          await api(`machines/${machineId}/signin-wake`, {}, signal);
          asked = true;
        } catch {
          // Looked at again on the next pass.
        }
      }
    }
    await pause(1000, signal);
  }
  return false;
}
