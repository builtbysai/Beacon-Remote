import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api.js";
import { LiveView, type ViewGrant } from "./LiveView.js";

// Helping someone without an account: the code they read out starts a session that they still approve on
// their own screen. The server creates a temporary guest identity that can do nothing else and expires.
export function GuestSupport() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<{ grant: ViewGrant; name: string } | null>(
    null,
  );

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy || view) return;
    setBusy(true);
    setError("");
    try {
      const grant = await api<ViewGrant & { machineName: string }>(
        "support/guest",
        { code },
      );
      setCode("");
      setView({ grant, name: grant.machineName });
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
    <>
      {!view && (
        <form className="assist-panel-body" onSubmit={connect}>
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
            />
          </label>
          {error && (
            <p className="assist-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || code.trim().length < 8}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}
      {view && (
        <LiveView
          key={view.grant.id}
          grant={view.grant}
          name={view.name}
          onClose={() => setView(null)}
        />
      )}
    </>
  );
}
