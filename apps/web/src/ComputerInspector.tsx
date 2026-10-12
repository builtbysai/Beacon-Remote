import { useState, type FormEvent } from "react";
import type { Machine } from "@beacon-remote/protocol";
import { api } from "./api.js";

export function ComputerInspector({
  machine,
  onClose,
  onUpdated,
  onRevoke,
  stale,
}: {
  machine: Machine;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onRevoke: () => Promise<void>;
  stale: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(machine.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`machines/${machine.id}/name`, { name });
      await onUpdated();
      setEditing(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not rename computer.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside
      className="device-inspector"
      aria-label="Computer details"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="inspector-heading">
        <h2>{machine.name}</h2>
        <button
          className="secondary"
          aria-label="Close computer details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p>
        {machine.revokedAt
          ? "Access revoked"
          : stale
            ? "Status unavailable"
            : machine.online
              ? "Online"
              : "Offline"}
      </p>
      {editing ? (
        <form
          onSubmit={(event) => {
            void rename(event);
          }}
        >
          <label htmlFor="computer-name">Computer name</label>
          <input
            id="computer-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={1}
            maxLength={80}
            autoFocus
          />
          <div className="actions">
            <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          className="secondary"
          disabled={Boolean(machine.revokedAt)}
          onClick={() => {
            setName(machine.name);
            setEditing(true);
          }}
        >
          Edit name
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <dl>
        <dt>Machine ID</dt>
        <dd>{machine.id}</dd>
        <dt>Last seen</dt>
        <dd>
          {machine.lastSeenAt
            ? new Date(machine.lastSeenAt).toLocaleString()
            : "Not reported"}
        </dd>
        <dt>Access</dt>
        <dd>Attended · View only</dd>
      </dl>
      <p className="note">
        Desktop viewing requires local approval. Keyboard and mouse control are
        unavailable.
      </p>
      {!machine.revokedAt && (
        <div className="inspector-revoke">
          {confirmRevoke ? (
            <>
              <p>
                Revoke this computer’s access? It must be paired again before
                another session.
              </p>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onRevoke();
                      setConfirmRevoke(false);
                    } catch {
                      setError("Could not revoke this computer.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Revoke access
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirmRevoke(false)}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              className="secondary"
              onClick={() => setConfirmRevoke(true)}
            >
              Revoke access…
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
