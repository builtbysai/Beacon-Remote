import { useEffect, useState } from "react";
import { api } from "./api.js";

export type SessionRecord = {
  id: string;
  machineName: string;
  source: "desktop" | "synthetic";
  capability?: "desktop:view" | "desktop:control";
  status: string;
  createdAt: string;
  expiresAt: string | null;
};

export function sessionState(status: string) {
  switch (status) {
    case "requested":
      return "Waiting for approval";
    case "connecting":
      return "Connecting";
    case "active":
      return "Active";
    case "denied":
      return "Declined";
    case "expired":
      return "Expired";
    case "ended":
      return "Ended";
    default:
      return status;
  }
}

export function SessionHistory() {
  const [data, setData] = useState<{
    available: boolean;
    sessions: SessionRecord[];
  } | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setError("");
    setLoading(true);
    void api<{ available: boolean; sessions: SessionRecord[] }>("sessions")
      .then((result) => {
        if (!disposed) setData(result);
      })
      .catch((failure) => {
        if (!disposed)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load sessions.",
          );
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [refresh]);

  const active =
    data?.sessions.filter((session) =>
      ["requested", "connecting", "active"].includes(session.status),
    ) ?? [];
  const recent =
    data?.sessions.filter(
      (session) =>
        !["requested", "connecting", "active"].includes(session.status),
    ) ?? [];

  async function stopSession(id: string) {
    setStopping(id);
    setError("");
    try {
      await api(`sessions/${id}/stop`, {});
      setRefresh((value) => value + 1);
    } catch {
      setError(
        "Could not stop this session. Refresh its status and try again.",
      );
    } finally {
      setStopping(null);
    }
  }

  return (
    <section className="workspace-page sessions-page">
      <div className="workspace-page-heading">
        <div>
          <h1>Sessions</h1>
          <p>Current connections and recent access requests</p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="sessions-workspace">
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <h2>Active</h2>
            <span>
              {active.length}{" "}
              {active.length === 1 ? "connection" : "connections"}
            </span>
          </div>
          {loading && !data ? (
            <p className="workspace-panel-empty" role="status">
              Loading sessions…
            </p>
          ) : error && !data ? (
            <p className="workspace-panel-empty">Unable to load sessions.</p>
          ) : data && !data.available ? (
            <p className="workspace-panel-empty">
              Desktop sessions are not enabled on this server.
            </p>
          ) : active.length === 0 ? (
            <div className="workspace-panel-empty">
              <strong>No active sessions</strong>
              <p>Start a viewing request from Computers.</p>
            </div>
          ) : (
            <ul className="session-rows">
              {active.map((session) => (
                <li key={session.id}>
                  <div>
                    <strong>{session.machineName}</strong>
                    <span>
                      {sessionState(session.status)} ·{" "}
                      {session.source === "desktop"
                        ? session.capability === "desktop:control"
                          ? "Mouse and keyboard"
                          : "View only"
                        : "Video test"}
                      {session.expiresAt === null
                        ? session.status === "active"
                          ? " · Until stopped"
                          : " · Approval expires after two minutes"
                        : ""}
                    </span>
                  </div>
                  <button
                    className="secondary"
                    disabled={stopping === session.id}
                    onClick={() => void stopSession(session.id)}
                  >
                    {stopping === session.id ? "Stopping…" : "Stop"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <h2>Recent sessions</h2>
            <span>{recent.length} shown</span>
          </div>
          {loading && !data ? (
            <p className="workspace-panel-empty" role="status">
              Loading history…
            </p>
          ) : error && !data ? (
            <p className="workspace-panel-empty">Unable to load history.</p>
          ) : recent.length === 0 ? (
            <p className="workspace-panel-empty">No recent sessions.</p>
          ) : (
            <ol className="session-rows">
              {recent.map((session) => (
                <li key={session.id}>
                  <div>
                    <strong>{session.machineName}</strong>
                    <span>
                      {session.source === "desktop"
                        ? session.capability === "desktop:control"
                          ? "Desktop control"
                          : "Desktop view"
                        : "Video test"}{" "}
                      · {sessionState(session.status)}
                    </span>
                  </div>
                  <time dateTime={session.createdAt}>
                    {new Date(session.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <p className="workspace-footnote">
        A request or approval does not establish that desktop video was viewed.
      </p>
    </section>
  );
}
