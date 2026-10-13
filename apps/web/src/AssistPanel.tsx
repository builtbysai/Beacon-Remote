import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api.js";
import type { ViewGrant } from "./LiveView.js";

export function AssistPanel({
  onClaimed,
  sessionActive = false,
}: {
  onClaimed: (grant: ViewGrant, name: string) => void;
  sessionActive?: boolean;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shared, setShared] = useState<
    | {
        id: string;
        machineName: string;
        capability: "desktop:view" | "desktop:control";
        expiresAtMillis: number;
        online: boolean;
      }[]
    | null
  >(null);
  useEffect(() => {
    api<{ shared: NonNullable<typeof shared> }>("shared")
      .then((result) => setShared(result.shared))
      .catch(() => setShared([]));
  }, []);

  async function connectShared(
    id: string,
    capability: "desktop:view" | "desktop:control",
  ) {
    if (busy || sessionActive) return;
    setBusy(true);
    setError("");
    try {
      const grant = await api<ViewGrant & { machineName: string }>(
        `relationships/${id}/sessions`,
        { capability },
      );
      onClaimed(grant, grant.machineName);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? "That computer is already sharing with someone."
          : "Could not connect. The computer may be offline, or the access may have ended.",
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
      const grant = await api<ViewGrant & { machineName: string }>(
        "support/claim",
        { code },
      );
      setCode("");
      onClaimed(grant, grant.machineName);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? "That support code did not work. Check it, or ask for a new one."
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
        <div>
          <h1>Assist</h1>
          <p>One-time remote support</p>
        </div>
      </div>
      <div className="assist-layout">
        <section className="workspace-panel">
          <div className="workspace-panel-heading">
            <h2>Connect using a code</h2>
          </div>
          <form className="assist-panel-body" onSubmit={connect}>
            <p>
              Enter the code the person at the computer read out. They still
              approve the connection on their screen, and the code works once.
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
              disabled={busy || sessionActive || code.trim().length < 8}
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </form>
        </section>
        {shared && shared.length > 0 && (
          <section className="workspace-panel">
            <div className="workspace-panel-heading">
              <h2>Shared with you</h2>
            </div>
            <div className="assist-panel-body">
              <p>
                Computers whose owners allowed you to ask for support. They
                still approve each connection.
              </p>
              <ul className="support-list">
                {shared.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {entry.machineName}
                      <small>
                        {entry.online ? "Online" : "Offline"} · until{" "}
                        {new Date(entry.expiresAtMillis).toLocaleDateString()}
                      </small>
                    </span>
                    <span className="support-actions">
                      <button
                        className="secondary"
                        disabled={busy || sessionActive || !entry.online}
                        onClick={() =>
                          void connectShared(entry.id, "desktop:view")
                        }
                      >
                        View
                      </button>
                      {entry.capability === "desktop:control" && (
                        <button
                          disabled={busy || sessionActive || !entry.online}
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
              code. Read the code to the person helping you. It expires in 15
              minutes and works once. You approve the connection, choose view or
              control when you get the code, and can stop at any time.
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
