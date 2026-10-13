import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api.js";

type State = { available: boolean; enabled: boolean };

// Two-step sign-in with an authenticator app (ADR 0025). Entering the key by hand works in every
// authenticator app, so no QR code library is needed.
export function MfaPanel() {
  const [state, setState] = useState<State | null>(null);
  const [secret, setSecret] = useState<{ key: string; url: string } | null>(
    null,
  );
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      setState(await api<State>("mfa"));
    } catch {
      setError("Could not load two-step sign-in.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function begin() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ secret: string; otpauthUrl: string }>(
        "mfa/setup",
        {},
      );
      setSecret({ key: result.secret, url: result.otpauthUrl });
    } catch {
      setError("Could not start setup.");
    } finally {
      setBusy(false);
    }
  }
  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ recoveryCodes: string[] }>("mfa/enable", {
        code,
      });
      setCodes(result.recoveryCodes);
      setSecret(null);
      await load();
    } catch {
      setError(
        "That code did not work. Check the time on your phone and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("mfa/disable", {
        password: form.get("password"),
        code: form.get("code"),
      });
      await load();
    } catch {
      setError("Password or code did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quiet-panel">
      <h2>Authenticator and recovery</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!state ? (
        <p role="status">Loading…</p>
      ) : !state.available ? (
        <p>Two-step sign-in is not available on this server.</p>
      ) : codes ? (
        <>
          <p>
            Two-step sign-in is on. Save these recovery codes somewhere safe.
            Each works once if you lose your authenticator, and they will not be
            shown again.
          </p>
          <pre className="recovery-codes">{codes.join("\n")}</pre>
          <button onClick={() => setCodes(null)}>I saved them</button>
        </>
      ) : state.enabled ? (
        <form onSubmit={disable} className="mfa-form">
          <p>
            Two-step sign-in is on. Signing in needs your password and a code
            from your authenticator app. Password recovery is not available yet.
          </p>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            Authenticator or recovery code
            <input name="code" autoComplete="one-time-code" required />
          </label>
          <button disabled={busy}>Turn off two-step sign-in</button>
        </form>
      ) : secret ? (
        <form onSubmit={enable} className="mfa-form">
          <p>
            In your authenticator app, add an account by entering this key, then
            type the six-digit code it shows.
          </p>
          <p>
            <code className="mfa-key">{secret.key}</code>
          </p>
          <p>
            <a href={secret.url}>Open in an authenticator app on this device</a>
          </p>
          <label>
            Six-digit code
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
            />
          </label>
          <button disabled={busy}>Turn on</button>
        </form>
      ) : (
        <>
          <p>
            Add a second step to signing in. This matters more once a computer
            allows your account to connect without asking.
          </p>
          <button disabled={busy} onClick={() => void begin()}>
            Set up two-step sign-in
          </button>
        </>
      )}
    </div>
  );
}
