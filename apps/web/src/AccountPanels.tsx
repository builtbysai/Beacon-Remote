import { useEffect, useState } from "react";
import { api } from "./api.js";

type BrowserSession = { expiresAt: string; current: boolean };
type Activity = {
  id: string;
  action: string;
  occurredAt: string;
  machineName: string | null;
};

export function AccountPanels({ activity }: { activity: boolean }) {
  const [sessions, setSessions] = useState<BrowserSession[] | null>(null);
  const [events, setEvents] = useState<Activity[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let disposed = false;
    setError("");
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
        });
    return () => {
      disposed = true;
    };
  }, [activity]);
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
  return (
    <section className="public-section">
      <h1>{activity ? "Activity" : "Settings"}</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {activity ? (
        <>
          <p>Recent enrollment and access revocation events.</p>
          {events === null && !error ? (
            <p role="status">Loading activity…</p>
          ) : events?.length === 0 ? (
            <div className="quiet-panel">No activity yet.</div>
          ) : (
            <ol className="history-list">
              {events?.map((event) => (
                <li key={event.id}>
                  <strong>
                    {event.action === "machine.enrolled"
                      ? "Computer paired"
                      : event.action === "machine.revoked"
                        ? "Access revoked"
                        : event.action}
                  </strong>
                  <span>{event.machineName ?? "Computer"}</span>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
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
      )}
    </section>
  );
}
