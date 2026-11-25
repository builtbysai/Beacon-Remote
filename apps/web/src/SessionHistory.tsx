import { useEffect, useState } from "react";
import { Empty } from "./Characters.js";
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
  // Measured by the viewer while the session ran; absent when nothing was sampled.
  quality?: {
    samples: number;
    route: string;
    height: number | null;
    fps: number | null;
    rttMs: number | null;
    rttP95Ms: number | null;
    lossPct: number | null;
  } | null;
};

export function qualityLine(quality: SessionRecord["quality"]): string {
  if (!quality) return "—";
  return [
    quality.route,
    quality.height ? `${quality.height}p` : null,
    quality.fps ? `${quality.fps} fps` : null,
    quality.rttMs === null ? null : `${quality.rttMs} ms`,
    quality.lossPct && quality.lossPct >= 0.5
      ? `${quality.lossPct}% loss`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What a person can do about a poor connection, from the numbers measured during the session. Null when it was fine,
 * or when there is nothing measured to judge. One sentence, most useful first; it never blames a side it cannot know.
 */
export function diagnosis(quality: SessionRecord["quality"]): string | null {
  if (!quality || quality.samples < 3 || quality.route === "Unavailable")
    return null;
  if (quality.lossPct !== null && quality.lossPct >= 2)
    return "Packets were lost. Try a wired connection or stronger Wi-Fi on either device.";
  const slow = quality.rttP95Ms ?? quality.rttMs;
  if (slow !== null && slow >= 250)
    return quality.route === "Relayed"
      ? "High delay over a relay. Try another network to check whether a direct connection is available."
      : "High network delay. Try a more stable network on either device.";
  if (quality.fps !== null && quality.fps > 0 && quality.fps < 10)
    return "The picture updated slowly. A quiet screen needs few updates; if motion stutters, try lower picture quality.";
  if (quality.route === "Relayed")
    return "Video used a relay. No change is needed if it felt responsive.";
  return null;
}

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
        <p className="note">Sessions are off on this server.</p>
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
            <Empty title="No sessions yet" tone="sun">
              Connect to a computer and its session shows up here.
            </Empty>
          ) : (
            recent.length > 0 && (
              <section className="session-recent" aria-label="Recent sessions">
                <h2 className="list-label">Recent</h2>
                <ol className="session-rows session-cards">
                  {recent.map((session) => (
                    <li key={session.id} data-result={session.status}>
                      <svg
                        className="session-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {session.capability === "desktop:control" ? (
                          <path d="m6 3 12 8-5.5 1.5L10 18 6 3Z" />
                        ) : (
                          <>
                            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                            <circle cx="12" cy="12" r="2.8" />
                          </>
                        )}
                      </svg>
                      <div>
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
                              : "View only"
                            : "Video test"}
                          {" · "}
                          {sessionState(session.status)}
                          {session.quality
                            ? ` · ${qualityLine(session.quality)}`
                            : ""}
                        </span>
                        {diagnosis(session.quality) && (
                          <small className="session-hint">
                            {diagnosis(session.quality)}
                          </small>
                        )}
                      </div>
                      <time dateTime={session.createdAt}>
                        {new Date(session.createdAt).toLocaleString([], {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
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
