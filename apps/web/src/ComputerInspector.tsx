import { useEffect, useState, type FormEvent } from "react";
import type { Machine } from "@beacon-remote/protocol";
import { api } from "./api.js";
import { activityLabel, type Activity } from "./AccountPanels.js";
import { sessionState, type SessionRecord } from "./SessionHistory.js";
import { WorkspaceIcon } from "./WorkspaceIcon.js";
import "./computer-inspector.css";

export function ComputerInspector({
  machine,
  onClose,
  onUpdated,
  onRevoke,
  stale,
  onRequestView,
  onRequestControl,
  viewEnabled = false,
  controlEnabled = false,
  requesting = false,
  sessionActive = false,
}: {
  machine: Machine;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onRevoke: () => Promise<void>;
  stale: boolean;
  onRequestView?: () => void;
  onRequestControl?: () => void;
  viewEnabled?: boolean;
  controlEnabled?: boolean;
  requesting?: boolean;
  sessionActive?: boolean;
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
  const unavailable = machine.revokedAt
    ? "Access is revoked. Pair this computer again to connect."
    : stale
      ? "Status is unavailable. Refresh computers before requesting access."
      : !machine.online
        ? "This computer is offline. Check its power, network and Windows agent."
        : sessionActive
          ? "End the current session before requesting another connection."
          : !viewEnabled
            ? "Desktop access is unavailable on this server."
            : "";
  const cannotConnect = Boolean(unavailable) || requesting || busy;
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
        <span className="inspector-avatar">
          <WorkspaceIcon name="computers" />
        </span>
        <button
          className="secondary inspector-edit"
          aria-label={`Edit ${machine.name}`}
          title="Edit computer name"
          disabled={busy || Boolean(machine.revokedAt)}
          onClick={() => {
            setName(machine.name);
            setEditing(true);
          }}
        >
          <WorkspaceIcon name="settings" />
        </button>
        <button
          className="secondary"
          aria-label="Close computer details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <h2 className="inspector-name">{machine.name}</h2>
      <p className="inspector-machine-id">{machine.id}</p>
      <p
        className={`inspector-state${machine.online && !stale && !machine.revokedAt ? " is-online" : ""}`}
      >
        <span className="inspector-status-dot" aria-hidden="true" />
        {machine.revokedAt
          ? "Access revoked"
          : stale
            ? "Status unavailable"
            : machine.online
              ? "Online"
              : "Offline"}
      </p>
      <div className="inspector-command">
        <button
          disabled={cannotConnect || !controlEnabled || !onRequestControl}
          onClick={onRequestControl}
          title={
            controlEnabled
              ? "Request keyboard and mouse control with local approval"
              : "Keyboard and mouse control are unavailable on this server"
          }
        >
          <WorkspaceIcon name="computers" /> Remote
        </button>
        <button
          className="secondary"
          disabled={cannotConnect || !onRequestView}
          onClick={onRequestView}
        >
          {requesting ? "Requesting…" : "View only"}
        </button>
      </div>
      {unavailable && (
        <p className="inspector-availability" role="status">
          {unavailable}
        </p>
      )}
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
      ) : null}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="inspector-detail-group">
        <h3>Device</h3>
        <dl>
          <dt>Access</dt>
          <dd>
            {controlEnabled
              ? "Attended · View or control"
              : "Attended · View only"}
          </dd>
          <dt>Approval</dt>
          <dd>Required on Windows</dd>
        </dl>
      </div>
      <div className="inspector-detail-group">
        <h3>Last report</h3>
        <dl>
          <dt>Last seen</dt>
          <dd>
            {machine.lastSeenAt
              ? new Date(machine.lastSeenAt).toLocaleString()
              : "Not reported"}
          </dd>
        </dl>
      </div>
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
        {controlEnabled
          ? "Each connection requires local approval. The person at the computer can stop sharing at any time."
          : "Desktop viewing requires local approval. Keyboard and mouse control are unavailable."}
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
