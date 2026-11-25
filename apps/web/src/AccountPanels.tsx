import { useEffect, useState } from "react";
import { Empty } from "./Characters.js";
import { DataPanel } from "./DataPanel.js";
import { MfaPanel } from "./MfaPanel.js";
import { TeamPanel } from "./TeamPanel.js";
import { api } from "./api.js";
import { AccountIdentity } from "./AccountIdentity.js";

const settingsSections = [
  { id: "account", label: "Account" },
  { id: "team", label: "Team" },
  { id: "data", label: "Data" },
] as const;

type BrowserSession = { expiresAt: string; current: boolean };
export type Activity = {
  id: string;
  action: string;
  occurredAt: string;
  machineName: string | null;
  // Who did it, when it was a helper or team member rather than this account.
  actor?: string | null;
};

export function activityLabel(action: string) {
  switch (action) {
    case "machine.enrolled":
      return "Computer paired";
    case "machine.boot.enabled":
      return "Availability before Windows sign-in enabled";
    case "machine.boot.disabled":
      return "Availability before Windows sign-in disabled";
    case "machine.revoked":
      return "Access revoked";
    case "machine.renamed":
      return "Computer renamed";
    case "desktop.view.accepted":
      return "Viewing approved";
    case "desktop.control.accepted":
      return "Control approved";
    case "desktop.control.denied":
      return "Control declined";
    case "desktop.control.requested:desktop":
      return "Control requested";
    case "desktop.control.interrupted:backend-restart":
      return "Control interrupted";
    case "desktop.view.denied":
      return "Viewing declined";
    case "desktop.view.interrupted:backend-restart":
      return "Viewing interrupted";
    case "desktop.view.requested:desktop":
      return "Viewing requested";
    case "desktop.view.requested:synthetic":
      return "Video test requested";
    case "machine.access.attended":
      return "Approval required again";
    case "machine.access.trusted-view":
      return "Trusted viewing turned on";
    case "machine.access.trusted-control":
      return "Trusted control turned on";
    case "machine.access.control-off":
      return "Trusted control turned off";
    case "machine.helpers.off":
      return "Helpers need approval again";
    case "machine.helpers.view":
      return "Remembered helpers may view without asking";
    case "machine.helpers.control":
      return "Remembered helpers may control without asking";
    case "support.invitation.created:view":
      return "Support code created (view)";
    case "support.invitation.created:control":
      return "Support code created (control)";
    case "support.invitation.claimed:view":
      return "Support code used (view)";
    case "support.invitation.claimed:control":
      return "Support code used (control)";
    case "support.relationship.granted:view":
      return "Support access given (view)";
    case "support.relationship.granted:control":
      return "Support access given (control)";
    case "support.relationship.revoked":
      return "Support access removed";
    case "team.member.added":
      return "Team member added";
    case "team.member.changed":
      return "Team member changed";
    case "team.member.removed":
      return "Team member removed";
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
  const [section, setSection] = useState<string>("account");
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
      ["Event", "Action", "Computer", "By", "Time"],
      ...visibleEvents.map((event) => [
        activityLabel(event.action),
        event.action,
        event.machineName ?? "Computer",
        event.actor ?? "",
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
          <h1>Activity</h1>
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
            <div className="filter-chips" role="group" aria-label="Show">
              {(
                [
                  ["all", "All"],
                  ["sessions", "Sessions"],
                  ["devices", "Computers"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="chip"
                  aria-pressed={eventFilter === id}
                  onClick={() => setEventFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span>{visibleEvents.length} shown</span>
          </div>
          {loading && events === null ? (
            <p className="workspace-panel-empty" role="status">
              Loading activity…
            </p>
          ) : error && events === null ? (
            <p className="workspace-panel-empty">Unable to load activity.</p>
          ) : visibleEvents.length === 0 ? (
            <Empty
              title={events?.length ? "Nothing matches" : "No activity yet"}
              tone="mint"
            >
              {events?.length
                ? "Try a different filter."
                : "Pairing, approvals and sessions are listed here."}
            </Empty>
          ) : (
            <ol className="activity-rows">
              {visibleEvents.map((event) => (
                <li
                  key={event.id}
                  data-kind={
                    event.action.startsWith("desktop.view.")
                      ? "session"
                      : "device"
                  }
                >
                  <strong>{activityLabel(event.action)}</strong>
                  <span>
                    {event.machineName ?? "Computer"}
                    {event.actor ? ` · by ${event.actor}` : ""}
                  </span>
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
    <section className="workspace-page settings-page">
      <div className="workspace-page-heading">
        <h1>Settings</h1>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              aria-controls={`settings-${item.id}`}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <section
            className="settings-section"
            id="settings-account"
            aria-label="Account and security"
            hidden={section !== "account"}
          >
            <AccountIdentity />
            <div id="settings-security">
              <MfaPanel />
              <div className="quiet-panel">
                <div className="settings-section-heading">
                  <h2>Signed-in browsers</h2>
                  <button
                    className="secondary"
                    disabled={loading || busy}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                {notice && (
                  <p role="status" className="notice">
                    {notice}
                  </p>
                )}
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
                  disabled={
                    busy || !sessions?.some((session) => !session.current)
                  }
                  onClick={() => {
                    void endOthers();
                  }}
                >
                  {busy ? "Ending sessions…" : "End other browser sessions"}
                </button>
              </div>
            </div>
          </section>
          <section
            className="settings-section"
            id="settings-team"
            aria-label="Team access"
            hidden={section !== "team"}
          >
            <TeamPanel />
          </section>
          <section
            className="settings-section"
            id="settings-data"
            aria-label="Data and deletion"
            hidden={section !== "data"}
          >
            <DataPanel />
          </section>
        </div>
      </div>
    </section>
  );
}
