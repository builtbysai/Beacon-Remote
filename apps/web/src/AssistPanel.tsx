import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api.js";
import type { ViewGrant } from "./LiveView.js";
import { SupportSessions } from "./SupportSessions.js";
import { useSessionRequest } from "./useSessionRequest.js";

export function AssistPanel({
  onClaimed,
  sessionActive = false,
}: {
  onClaimed: (grant: ViewGrant, name: string) => boolean | void;
  sessionActive?: boolean;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connection = useSessionRequest(onClaimed, sessionActive);
  const [shared, setShared] = useState<
    | {
        id: string;
        machineName: string;
        capability: "desktop:view" | "desktop:control";
        expiresAtMillis: number | null;
        ownerEmail: string;
        team: boolean;
        online: boolean;
      }[]
    | null
  >(null);
  const [sharedError, setSharedError] = useState(false);
  const [sharedAttempt, setSharedAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSharedError(false);
    api<{ shared: NonNullable<typeof shared> }>("shared")
      .then((result) => {
        if (live) setShared(result.shared);
      })
      .catch(() => {
        if (live) setSharedError(true);
      });
    return () => {
      live = false;
    };
  }, [sharedAttempt]);

  async function connectShared(
    id: string,
    capability: "desktop:view" | "desktop:control",
  ) {
    if (busy || sessionActive) return;
    setBusy(true);
    setError("");
    try {
      await connection.request(async () => {
        const grant = await api<ViewGrant & { machineName: string }>(
          `relationships/${id}/sessions`,
          { capability },
        );
        return { grant, name: grant.machineName };
      });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? "That computer is already sharing with someone."
          : "Could not connect. The computer may be offline or access may have ended.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy || sessionActive) return;
    setBusy(true);
    setError("");
    try {
      await connection.request(async () => {
        const grant = await api<ViewGrant & { machineName: string }>(
          "support/claim",
          { code },
        );
        setCode("");
        return { grant, name: grant.machineName };
      });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? "That code didn’t work. Check it or ask for a new one."
          : failure instanceof ApiError && failure.status === 409
            ? "That computer is already sharing with someone."
            : failure instanceof ApiError
              ? failure.message
              : "Could not connect. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-page assist-page">
      <div className="workspace-page-heading">
        <h1>Assist</h1>
      </div>
      <div className="assist-layout">
        <SupportSessions
          requestSession={connection.request}
          sessionActive={sessionActive || connection.pending}
        />
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <h2>Connect using a code</h2>
          </div>
          <form className="assist-panel-body" onSubmit={connect}>
            <p>
              Enter the code they read to you. They still approve on their
              screen.
            </p>
            <label className="assist-code">
              Support code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                placeholder="ABCD-EFGH"
                inputMode="text"
              />
            </label>
            {error && (
              <p className="assist-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={
                busy ||
                connection.pending ||
                sessionActive ||
                code.trim().length < 8
              }
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </form>
        </section>
        {(shared === null || sharedError || shared.length > 0) && (
          <section className="workspace-panel">
            <div className="workspace-panel-heading">
              <h2>Shared with you</h2>
            </div>
            <div className="assist-panel-body">
              <p>
                Computers whose owners let you ask for support. They still
                approve each connection.
              </p>
              {sharedError && (
                <p className="error" role="alert">
                  Could not load shared computers.{" "}
                  <button
                    className="secondary"
                    onClick={() => setSharedAttempt((value) => value + 1)}
                  >
                    Try again
                  </button>
                </p>
              )}
              {shared === null && !sharedError && (
                <p role="status">Loading shared computers...</p>
              )}
              <ul className="support-list">
                {(shared ?? []).map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {entry.machineName}
                      <small>
                        {entry.ownerEmail} ·{" "}
                        {entry.online ? "Online" : "Offline"} ·{" "}
                        {entry.expiresAtMillis === null
                          ? "team access"
                          : `until ${new Date(entry.expiresAtMillis).toLocaleDateString()}`}
                      </small>
                    </span>
                    <span className="support-actions">
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          connection.pending ||
                          sessionActive ||
                          sharedError ||
                          !entry.online
                        }
                        onClick={() =>
                          void connectShared(entry.id, "desktop:view")
                        }
                      >
                        View
                      </button>
                      {entry.capability === "desktop:control" && (
                        <button
                          disabled={
                            busy ||
                            connection.pending ||
                            sessionActive ||
                            sharedError ||
                            !entry.online
                          }
                          onClick={() =>
                            void connectShared(entry.id, "desktop:control")
                          }
                        >
                          Control
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <h2>Share this computer</h2>
          </div>
          <div className="assist-panel-body">
            <p>
              Open Beacon Remote on the Windows computer and choose Support
              code. Read the code to the person helping you. It works once and
              expires in 15 minutes. You approve the connection and can stop at
              any time.
            </p>
            <a className="button secondary" href="#downloads">
              Windows setup
            </a>
          </div>
        </section>
      </div>
    </section>
  );
}
