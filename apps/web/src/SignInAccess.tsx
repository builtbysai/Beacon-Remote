import { useEffect, useState } from "react";
import { signinAuthorityState } from "@beacon-remote/protocol";
import { api } from "./api.js";

export function SignInAccess({
  machineId,
  disabled,
  onOpen,
}: {
  machineId: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const [state, setState] = useState<{
    enabled: boolean;
    endpointReady: boolean;
    connectable: boolean;
  } | null>(null);
  useEffect(() => {
    setState(null);
    let disposed = false,
      pending = false;
    const abort = new AbortController();
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const raw = await api<unknown>(
          `machines/${machineId}/signin-authority`,
          undefined,
          AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
        );
        const parsed = signinAuthorityState.safeParse(raw);
        if (!disposed) setState(parsed.success ? parsed.data : null);
      } catch {
        if (!disposed) setState(null);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      abort.abort();
      clearInterval(timer);
    };
  }, [machineId]);
  if (!state?.enabled) return null;
  const available = state.endpointReady && state.connectable;
  return (
    <div className="signin-access">
      <p>Windows sign-in · {available ? "Available" : "Unavailable"}</p>
      <button
        className="secondary"
        disabled={disabled || !available}
        onClick={onOpen}
      >
        Open sign-in
      </button>
    </div>
  );
}
