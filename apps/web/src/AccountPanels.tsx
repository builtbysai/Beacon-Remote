import { useEffect, useState } from "react";
import { api } from "./api.js";

type BrowserSession = { expiresAt: string; current: boolean };
type Activity = {
  id: string;
  action: string;
  occurredAt: string;
  machineName: string | null;
};

function activityLabel(action: string) {
  switch (action) {
    case "machine.enrolled":
      return "Computer paired";
    case "machine.revoked":
      return "Access revoked";
    case "machine.renamed":
      return "Computer renamed";
    case "desktop.view.accepted":
      return "Viewing approved";
    case "desktop.view.denied":
      return "Viewing declined";
    case "desktop.view.interrupted:backend-restart":
      return "Viewing interrupted";
    case "desktop.view.requested:desktop":
      return "Viewing requested";
    case "desktop.view.requested:synthetic":
      return "Video test requested";
    default:
      return action;
  }
}

export function AccountPanels({ activity }: { activity: boolean }) {
  const [sessions, setSessions] = useState<BrowserSession[] | null>(null);
  const [events, setEvents] = useState<Activity[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eventFilter, setEventFilter] = useState("all");
  useEffect(() => {
    let disposed = false;
    setError("");
    setNotice("");
    setSessions(null);
    setEvents(null);
    setLoading(true);
    if (activity)
      void api<{ events: Activity[] }>("activity")
        .then((data) => {
          if (!disposed) setEvents(data.events);
        })
        .catch((failure) => {
          if (!disposed)
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not load activity.",
            );
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    else
      void api<{ sessions: BrowserSession[] }>("account/sessions")
        .then((data) => {
          if (!disposed) setSessions(data.sessions);
        })
        .catch((failure) => {
          if (!disposed)
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not load browser sessions.",
            );
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    return () => {
      disposed = true;
    };
  }, [activity, refresh]);
  async function endOthers() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("account/sessions/end-others", {});
      const result = await api<{ sessions: BrowserSession[] }>(
        "account/sessions",
      );
      setSessions(result.sessions);
      setNotice("Other browser sessions ended.");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not end sessions.",
      );
    } finally {
      setBusy(false);
    }
  }
  const visibleEvents = (events ?? []).filter(
    (event) =>
      eventFilter === "all" ||
      (eventFilter === "sessions"
        ? event.action.startsWith("desktop.view.")
        : event.action.startsWith("machine.")),
  );
  function exportEvents() {
    const safeCell = (value: string) => {
      const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["Event", "Action", "Computer", "Time"],
      ...visibleEvents.map((event) => [
        activityLabel(event.action),
        event.action,
        event.machineName ?? "Computer",
        event.occurredAt,
      ]),
    ];
    const file = new Blob(
      [rows.map((row) => row.map(safeCell).join(",")).join("\r\n")],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "beacon-remote-activity.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  if (activity)
    return (
      <section className="workspace-page activity-page">
        <div className="workspace-page-heading">
          <div>
            <h1>Activity</h1>
            <p>Connections and device events</p>
          </div>
          <div className="activity-heading-actions">
            <button
              className="secondary"
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="secondary"
              disabled={!visibleEvents.length}
              onClick={exportEvents}
            >
              Export shown rows
            </button>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="workspace-panel activity-workspace">
          <div className="activity-tools">
            <label htmlFor="activity-filter">Show</label>
            <select
              id="activity-filter"
              value={eventFilter}
              onChange={(event) => setEventFilter(event.target.value)}
            >
              <option value="all">All events</option>
              <option value="sessions">Sessions</option>
              <option value="devices">Device events</option>
            </select>
            <span>{visibleEvents.length} shown</span>
          </div>
          <div className="activity-table-head" aria-hidden="true">
            <span>Event</span>
            <span>Computer</span>
            <span>Time</span>
          </div>
          {loading && events === null ? (
            <p className="workspace-panel-empty" role="status">
              Loading activity…
            </p>
          ) : error && events === null ? (
            <p className="workspace-panel-empty">Unable to load activity.</p>
          ) : visibleEvents.length === 0 ? (
            <p className="workspace-panel-empty">
              {events?.length
                ? "No events match this filter."
                : "No activity yet."}
            </p>
          ) : (
            <ol className="activity-rows">
              {visibleEvents.map((event) => (
                <li key={event.id}>
                  <strong>{activityLabel(event.action)}</strong>
                  <span>{event.machineName ?? "Computer"}</span>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    );
  return (
    <section className="public-section">
      <h1>Settings</h1>
      <button
        disabled={loading || busy}
        onClick={() => setRefresh((value) => value + 1)}
      >
        {loading ? "Refreshing…" : error ? "Try again" : "Refresh"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <>
        <h2>Account security</h2>
        <p>
          Browser sessions expire after eight hours. Sign out to end this
          browser’s session.
        </p>
        <div className="quiet-panel">
          <h3>Browser sessions</h3>
          {sessions === null && !error ? (
            <p role="status">Loading browser sessions…</p>
          ) : (
            <ul className="history-list">
              {sessions?.map((session, index) => (
                <li key={`${session.expiresAt}-${index}`}>
                  <strong>
                    {session.current
                      ? "This browser"
                      : "Another browser session"}
                  </strong>
                  <span>
                    Expires {new Date(session.expiresAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            disabled={busy || !sessions?.some((session) => !session.current)}
            onClick={() => {
              void endOthers();
            }}
          >
            {busy ? "Ending sessions…" : "End other browser sessions"}
          </button>
        </div>
        <div className="quiet-panel">
          <h3>Authenticator and recovery</h3>
          <p>MFA and password recovery are not available yet.</p>
        </div>
      </>
    </section>
  );
}
