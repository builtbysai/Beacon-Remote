import { useEffect, useState, type FormEvent } from "react";
import type { Machine } from "@beacon-remote/protocol";
import { api } from "./api.js";
import { activityLabel, type Activity } from "./AccountPanels.js";
import { sessionState, type SessionRecord } from "./SessionHistory.js";

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [history, setHistory] = useState<{
    events: Activity[];
    sessions: SessionRecord[];
    sessionsAvailable: boolean;
  } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    if (!historyOpen) return;
    let disposed = false;
    setHistory(null);
    setHistoryLoading(true);
    setHistoryError("");
    const filter = `machineId=${encodeURIComponent(machine.id)}`;
    void Promise.all([
      api<{ events: Activity[] }>(`activity?${filter}`),
      api<{ available: boolean; sessions: SessionRecord[] }>(
        `sessions?${filter}`,
      ),
    ])
      .then(([activity, sessions]) => {
        if (!disposed)
          setHistory({
            events: activity.events,
            sessions: sessions.sessions,
            sessionsAvailable: sessions.available,
          });
      })
      .catch(() => {
        if (!disposed)
          setHistoryError("Could not load this computer’s history.");
      })
      .finally(() => {
        if (!disposed) setHistoryLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [historyOpen, historyRefresh, machine.id, machine.revokedAt]);
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
      <details
        className="inspector-history"
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary>Activity and sessions</summary>
        <div className="inspector-history-content">
          <button
            className="secondary"
            disabled={historyLoading}
            onClick={() => setHistoryRefresh((value) => value + 1)}
          >
            {historyLoading ? "Refreshing…" : "Refresh history"}
          </button>
          {historyError && (
            <p role="alert" className="error">
              {historyError}
            </p>
          )}
          {historyLoading && !history && <p role="status">Loading history…</p>}
          {history && (
            <>
              <h3>Recent activity</h3>
              {history.events.length ? (
                <ul>
                  {history.events.slice(0, 5).map((event) => (
                    <li key={event.id}>
                      <strong>{activityLabel(event.action)}</strong>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No activity for this computer.</p>
              )}
              <h3>Recent view requests</h3>
              {!history.sessionsAvailable ? (
                <p>Viewing history is unavailable on this server.</p>
              ) : history.sessions.length ? (
                <ul>
                  {history.sessions.slice(0, 5).map((session) => (
                    <li key={session.id}>
                      <strong>{sessionState(session.status)}</strong>
                      <time dateTime={session.createdAt}>
                        {new Date(session.createdAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No view requests for this computer.</p>
              )}
            </>
          )}
        </div>
      </details>
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
