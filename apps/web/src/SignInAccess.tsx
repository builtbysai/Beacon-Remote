import { useEffect, useRef, useState } from "react";
import { signinAuthorityState } from "@beacon-remote/protocol";
import { api } from "./api.js";

// How long the viewer waits for the password prompt after asking for it.
const WAKE_WAIT_MS = 25_000;

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
    state: "unavailable" | "sign-in" | "signed-in";
    endpointReady: boolean;
    connectable: boolean;
    wakeable?: boolean;
  } | null>(null);
  // Set while the computer raises its password prompt for this viewer; the sign-in screen opens by itself when ready.
  const [waking, setWaking] = useState<number | null>(null);
  const [wakeFailed, setWakeFailed] = useState(false);
  const refreshNow = useRef<() => void>(() => {});
  useEffect(() => {
    setState(null);
    setWaking(null);
    setWakeFailed(false);
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
    refreshNow.current = () => void refresh();
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      disposed = true;
      abort.abort();
      clearInterval(timer);
    };
  }, [machineId]);
  const available = Boolean(state?.endpointReady && state.connectable);
  // While waking, look every second instead of every five.
  useEffect(() => {
    if (waking === null) return;
    const timer = setInterval(() => refreshNow.current(), 1000);
    return () => clearInterval(timer);
  }, [waking]);
  useEffect(() => {
    if (waking === null) return;
    if (available) {
      setWaking(null);
      if (!disabled) onOpen();
      return;
    }
    const left = waking - Date.now();
    const timer = setTimeout(
      () => {
        setWaking(null);
        setWakeFailed(true);
      },
      Math.max(0, left),
    );
    return () => clearTimeout(timer);
  }, [waking, available, disabled, onOpen]);
  if (!state?.enabled) return null;
  // Someone is signed in: the desktop is the way in (Remote), so a sign-in row would only read as a fault.
  if (state.state === "signed-in" && waking === null && !wakeFailed)
    return null;
  const wakeable = !available && Boolean(state.wakeable);
  const wake = async () => {
    setWakeFailed(false);
    try {
      await api(`machines/${machineId}/signin-wake`, {});
      setWaking(Date.now() + WAKE_WAIT_MS);
    } catch {
      setWakeFailed(true);
    }
  };
  const status = available
    ? "Available"
    : waking !== null
      ? "Bringing up the password prompt…"
      : wakeable
        ? "Locked"
        : "Not reachable right now";
  return (
    <div className="signin-access">
      <p>Windows sign-in · {status}</p>
      {wakeFailed && (
        <p className="signin-access-note">
          The password prompt did not come up. Try again, or press a key at the
          computer.
        </p>
      )}
      {wakeable || waking !== null ? (
        <button
          className="secondary"
          disabled={disabled || waking !== null}
          onClick={() => void wake()}
        >
          Open sign-in
        </button>
      ) : (
        <button
          className="secondary"
          disabled={disabled || !available}
          onClick={onOpen}
        >
          Open sign-in
        </button>
      )}
    </div>
  );
}
