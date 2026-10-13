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
  // Set when someone else (a support helper) ran this session on your computer.
  controller?: string | null;
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
        <h1>Sessions</h1>
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
      {loading && !data ? (
        <p className="note" role="status">
          Loading sessions…
        </p>
      ) : error && !data ? (
        <p className="note">Unable to load sessions.</p>
      ) : data && !data.available ? (
        <p className="note">Desktop sessions are not enabled on this server.</p>
      ) : (
        <>
          {active.length > 0 && (
            <section className="workspace-panel" aria-label="Active sessions">
              <ul className="session-rows">
                {active.map((session) => (
                  <li key={session.id}>
                    <span className="status-dot online" aria-hidden="true" />
                    <div>
                      <strong>
                        {session.machineName}
                        {session.controller
                          ? ` · by ${session.controller}`
                          : ""}
                      </strong>
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
            </section>
          )}
          {recent.length === 0 && active.length === 0 ? (
            <p className="note">
              No sessions yet. Connect to a computer from Computers and it will
              be listed here.
            </p>
          ) : (
            recent.length > 0 && (
              <section className="workspace-panel" aria-label="Recent sessions">
                <div className="session-table-head" aria-hidden="true">
                  <span>Computer</span>
                  <span>Access</span>
                  <span>Result</span>
                  <span>When</span>
                </div>
                <ol className="session-rows session-table">
                  {recent.map((session) => (
                    <li key={session.id}>
                      <strong>
                        {session.machineName}
                        {session.controller
                          ? ` · by ${session.controller}`
                          : ""}
                      </strong>
                      <span>
                        {session.source === "desktop"
                          ? session.capability === "desktop:control"
                            ? "Control"
                            : "View"
                          : "Video test"}
                      </span>
                      <span>{sessionState(session.status)}</span>
                      <time dateTime={session.createdAt}>
                        {new Date(session.createdAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ol>
              </section>
            )
          )}
        </>
      )}
    </section>
  );
}
