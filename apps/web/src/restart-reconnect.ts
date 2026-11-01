import type { Machine } from "@beacon-remote/protocol";
import { ApiError } from "./api.js";

// A reboot ends the old grant. Wait for a new host process (including fast
// restarts), or an observed offline/online transition on older endpoints.
export async function waitForRestart(options: {
  machineId: string;
  previousInstance: string | null;
  capability: "desktop:view" | "desktop:control";
  observe: () => Promise<Machine[]>;
  isCurrent: () => boolean;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  windowMs?: number;
}): Promise<Machine | null> {
  const now = options.now ?? (() => performance.now());
  const sleep =
    options.sleep ??
    ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const deadline = now() + (options.windowMs ?? 600_000);
  let wentOffline = false;
  while (options.isCurrent()) {
    if (now() >= deadline)
      throw new Error(
        "Reconnect timed out. The computer may still be restarting or waiting for Windows sign-in.",
      );
    let machines: Machine[];
    try {
      machines = await options.observe();
    } catch (error) {
      if (!options.isCurrent()) return null;
      if (
        !(error instanceof TypeError) &&
        !(error instanceof DOMException && error.name === "TimeoutError") &&
        !(
          error instanceof ApiError &&
          (error.status >= 500 || error.status === 408 || error.status === 429)
        )
      )
        throw error;
      await sleep(5000);
      continue;
    }
    if (!options.isCurrent()) return null;
    if (now() >= deadline) continue;
    const machine = machines.find((entry) => entry.id === options.machineId);
    if (
      !machine ||
      machine.revokedAt ||
      machine.uninstallPending ||
      machine.uninstalledAt
    )
      throw new Error(
        "Reconnect stopped because this computer's access was removed.",
      );
    if (
      machine.accessMode !== "trusted" ||
      (options.capability === "desktop:control" && !machine.allowControl)
    )
      throw new Error(
        "Reconnect stopped because unattended permission changed.",
      );
    if (!machine.online) wentOffline = true;
    const newHost = Boolean(
      options.previousInstance &&
      machine.hostInstanceId &&
      options.previousInstance !== machine.hostInstanceId,
    );
    if (machine.online && (newHost || wentOffline)) return machine;
    await sleep(5000);
  }
  return null;
}
