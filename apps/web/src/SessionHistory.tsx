import { useEffect, useState } from "react";
import { api } from "./api.js";

type SessionRecord = {
  id: string;
  machineName: string;
  source: "desktop" | "synthetic";
  status: string;
  createdAt: string;
  expiresAt: string;
};
export function SessionHistory() {
  const [data, setData] = useState<{
    available: boolean;
    sessions: SessionRecord[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
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
      });
    return () => {
      disposed = true;
    };
  }, []);
  return (
    <section className="public-section">
      <h1>Sessions</h1>
      <p>
        Recent view requests. A request does not establish that desktop media
        was viewed.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading sessions…</p>}
      {data && !data.available ? (
        <div className="quiet-panel">
          Desktop sessions are not enabled on this server.
        </div>
      ) : data?.sessions.length === 0 ? (
        <div className="quiet-panel">
          No sessions yet. Choose a computer to request attended viewing.
        </div>
      ) : (
        <ol className="history-list">
          {data?.sessions.map((session) => (
            <li key={session.id}>
              <strong>{session.machineName}</strong>
              <span>
                {session.source === "desktop"
                  ? "Desktop · View only"
                  : "Synthetic connection test"}{" "}
                · {session.status}
              </span>
              <time dateTime={session.createdAt}>
                {new Date(session.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
