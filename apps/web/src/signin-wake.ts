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

const REASK_MS = 6000;

/**
 * Brings a locked computer's password prompt up (asking while the endpoint is on the lock-screen picture, again every few seconds if it stays) and
 * resolves true when the sign-in screen can be opened. False when the computer is signed in, unreachable or the
 * prompt did not come up in time.
 */
export async function wakeSignIn(
  machineId: string,
  signal: AbortSignal,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // When the next ask may go: at once, then again every few seconds while the picture is still up (a press can be
  // spent waking a dimmed screen).
  let nextAsk = 0;
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
      if (Date.now() >= nextAsk && state.data.wakeable) {
        try {
          await api(`machines/${machineId}/signin-wake`, {}, signal);
          nextAsk = Date.now() + REASK_MS;
        } catch {
          // Looked at again on the next pass.
        }
      }
    }
    await pause(1000, signal);
  }
  return false;
}
