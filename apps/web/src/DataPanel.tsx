import { useState, type FormEvent } from "react";
import { api } from "./api.js";

// Export and deletion of the account's own data. Both ask for the password again, and the authenticator
// code when two-step sign-in is on, so a borrowed browser session cannot take or erase the account.
export function DataPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);

  const fields = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const code = String(data.get("code") ?? "").trim();
    return {
      password: String(data.get("password") ?? ""),
      ...(code ? { code } : {}),
      word: String(data.get("confirm") ?? ""),
    };
  };

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { password, code } = fields(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api<unknown>("account/export", { password, code });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "beacon-remote-data.json";
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Your data was downloaded.");
      event.currentTarget.reset();
    } catch {
      setError("The password or code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function erase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { password, code, word } = fields(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("account/delete", { password, code, confirm: word });
      window.location.hash = "#home";
      window.location.reload();
    } catch {
      setError("The password, code or confirmation did not work.");
      setBusy(false);
    }
  }

  return (
    <div className="quiet-panel">
      <h3>Your data</h3>
      <p>
        Download everything this service holds about your account: your
        computers, session history and activity. Passwords and keys are never
        included.
      </p>
      <form onSubmit={download} className="mfa-form">
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
          Authenticator code (only if two-step sign-in is on)
          <input name="code" autoComplete="one-time-code" />
        </label>
        <button disabled={busy}>Download my data</button>
      </form>
      {notice && <p role="status">{notice}</p>}
      <h3>Delete account</h3>
      {deleting ? (
        <form onSubmit={erase} className="mfa-form">
          <p>
            This removes your account, every computer paired to it, and all
            history. It cannot be undone. Computers stop being reachable at once
            and can be paired again to a new account.
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
            Authenticator code (only if two-step sign-in is on)
            <input name="code" autoComplete="one-time-code" />
          </label>
          <label>
            Type DELETE to confirm
            <input name="confirm" autoComplete="off" required />
          </label>
          <button className="danger" disabled={busy}>
            Delete my account
          </button>{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => setDeleting(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button className="secondary" onClick={() => setDeleting(true)}>
          Delete my account…
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
