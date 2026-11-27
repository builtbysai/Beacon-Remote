import { useEffect, useRef, useState } from "react";
import type { Machine } from "@beacon-remote/protocol";
import { api } from "./api.js";

type Action = "disconnect" | "revoke" | "uninstall" | "restart";

// The three ways to take access away from a computer, kept distinct (ADR 0039): end what is happening now, remove its
// authority, or remove Beacon Remote from it as well.
export function DeviceActions({
  machine,
  onRevoke,
  onChanged,
  onRestart,
}: {
  machine: Machine;
  onRevoke: () => Promise<void>;
  onChanged: () => Promise<void>;
  onRestart?: (previousInstance: string | null) => void;
}) {
  const [asking, setAsking] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (machine.uninstalledAt)
    return (
      <p className="note inspector-revoke">
        Beacon Remote was removed from this computer.
      </p>
    );
  if (machine.uninstallPending)
    return (
      <p className="note inspector-revoke">
        Removal requested. This computer can no longer be connected to. If it
        comes online within 30 days it removes Beacon Remote itself.
      </p>
    );
  if (machine.revokedAt || machine.temporary) return null;

  async function run(action: Action) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      if (action === "revoke") await onRevoke();
      else {
        const result = await api<{
          online?: boolean;
          hostInstanceId?: string | null;
        }>(`machines/${machine.id}/${action}`, {});
        if (action === "restart" && reconnect && mounted.current)
          onRestart?.(result.hostInstanceId ?? null);
        setNote(
          action === "restart"
            ? "Restart requested. The person at the computer can cancel Windows’ 30-second countdown."
            : action === "disconnect"
              ? "Any active session was ended. The computer stays available."
              : result.online
                ? "Removal started. Beacon Remote is uninstalling itself."
                : "Access revoked now. Beacon Remote removes itself if this computer comes online within 30 days.",
        );
        await onChanged();
      }
      setAsking(null);
    } catch {
      setError("That didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const copy: Record<Action, { label: string; text: string; go: string }> = {
    disconnect: {
      label: "Disconnect now",
      text: "End any session on this computer. It stays available for future connections.",
      go: "Disconnect",
    },
    revoke: {
      label: "Revoke access…",
      text: "Revoke access? The computer must be paired again before another session. Beacon Remote stays installed.",
      go: "Revoke access",
    },
    restart: {
      label: "Restart computer…",
      text: "Restart in 30 seconds? Active sessions end and unsaved work can be lost. The person at the computer can cancel the countdown.",
      go: "Restart",
    },
    uninstall: {
      label: "Uninstall and remove…",
      text: "Revoke access and remove Beacon Remote? If the computer is online it uninstalls itself and says so on screen. If not, access ends now and it uninstalls itself if it connects within 30 days.",
      go: "Uninstall and remove",
    },
  };
  async function wakeUp() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await api<{ via?: string }>(
        `machines/${machine.id}/wake`,
        {},
      );
      setNote(
        `Asked ${result.via ?? "another computer on its network"} to send a wake signal. It can take up to a minute.`,
      );
    } catch {
      setError("Could not send the wake signal. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inspector-revoke">
      {machine.canWake && !machine.online && (
        <div className="actions">
          <button disabled={busy} onClick={() => void wakeUp()}>
            Wake this computer
          </button>
        </div>
      )}
      {asking ? (
        <>
          <p>{copy[asking].text}</p>
          {asking === "restart" && onRestart && (
            <label>
              <input
                type="checkbox"
                checked={reconnect}
                disabled={busy}
                onChange={(event) => setReconnect(event.target.checked)}
              />
              Reconnect automatically when this computer returns
              <span className="field-help"> Uses current permissions.</span>
            </label>
          )}
          <div className="actions">
            <button
              className={
                asking === "revoke" || asking === "uninstall" ? "danger" : ""
              }
              disabled={busy}
              onClick={() => void run(asking)}
            >
              {copy[asking].go}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setAsking(null)}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          {(
            [
              "disconnect",
              ...(machine.online &&
              machine.accessMode === "trusted" &&
              machine.allowControl
                ? ["restart"]
                : []),
              "revoke",
              "uninstall",
            ] as Action[]
          ).map((action) => (
            <button
              key={action}
              className={
                action === "revoke" || action === "uninstall"
                  ? "secondary quiet-danger"
                  : "secondary"
              }
              onClick={() => setAsking(action)}
            >
              {copy[action].label}
            </button>
          ))}
        </div>
      )}
      {note && <p className="note">{note}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
