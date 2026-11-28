import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api.js";

type Config = { open: boolean; emailRecovery: boolean };
export type EntryConfig = Config & {
  /** Loading, known, or unknown because the server could not be asked (not the same as "closed"). */
  state: "loading" | "ready" | "unavailable";
  retry: () => void;
};

// Whether this server can send mail: sign-up and email recovery are offered only when it can. A failed check is
// reported as unknown with a retry, never as "sign-up is closed".
export function useEntryConfig(): EntryConfig {
  const [config, setConfig] = useState<Config>({
    open: false,
    emailRecovery: false,
  });
  const [state, setState] = useState<EntryConfig["state"]>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState("loading");
    api<Config>("signup/config")
      .then((result) => {
        if (!live) return;
        setConfig(result);
        setState("ready");
      })
      .catch(() => {
        if (live) setState("unavailable");
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  return { ...config, state, retry: () => setAttempt((value) => value + 1) };
}

export function SignupForm({ onSignIn }: { onSignIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      await api("signup", { email, password: form.get("password") });
      setSentTo(email);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 503
          ? "We could not send the email just now. Try again in a few minutes."
          : failure instanceof ApiError && failure.status === 429
            ? failure.message
            : "Check the address and use a password of at least 12 characters.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (!sentTo) return;
    setBusy(true);
    try {
      await api("signup/resend", { email: sentTo });
      setResent(true);
    } catch {
      setError("We could not send another email just now.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo)
    return (
      <>
        <h1>Check your email</h1>
        <p role="status">
          If {sentTo} can be used, a confirmation link is on its way. It works
          once and expires in 24 hours.
        </p>
        <button
          className="secondary"
          disabled={busy || resent}
          onClick={() => void resend()}
        >
          {resent ? "Sent again" : "Send the link again"}
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="note">
          <a href="#signin" onClick={onSignIn}>
            Back to sign in
          </a>
        </p>
      </>
    );
  return (
    <>
      <h1>Create your account</h1>
      <p>We will email a link to confirm your address.</p>
      <form onSubmit={submit}>
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            autoFocus
          />
        </label>
        <label>
          Password (at least 12 characters)
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={512}
            required
          />
        </label>
        <button disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="note">
        Already have an account?{" "}
        <a href="#signin" onClick={onSignIn}>
          Sign in
        </a>
      </p>
    </>
  );
}

export function ForgotForm({ onSignIn }: { onSignIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setBusy(true);
    setError("");
    try {
      await api("account/recover/request", { email: email.trim() });
      setSent(true);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? failure.message
          : "We could not send the email just now. Try again in a few minutes.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>Reset your password</h1>
      {sent ? (
        <p role="status">
          If that address has an account, a reset link is on its way. It works
          once and expires in 30 minutes.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              autoFocus
            />
          </label>
          <button disabled={busy}>Send reset link</button>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="note">
        <a href="#signin" onClick={onSignIn}>
          Back to sign in
        </a>
      </p>
    </>
  );
}

export function VerifyEmail({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [state, setState] = useState<"working" | "ok" | "failed">("working");
  useEffect(() => {
    let live = true;
    api("signup/verify", { token })
      .then(() => live && setState("ok"))
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, [token]);
  return (
    <>
      <h1>
        {state === "ok"
          ? "Email confirmed"
          : state === "failed"
            ? "That link did not work"
            : "Confirming…"}
      </h1>
      {state === "working" && <p role="status">One moment.</p>}
      {state === "ok" && (
        <>
          <p role="status">Your account is ready and you are signed in.</p>
          <button onClick={onDone}>Open workspace</button>
        </>
      )}
      {state === "failed" && (
        <p role="alert">
          The link may have expired or already been used. Sign in to ask for a
          new one.
        </p>
      )}
      {state === "failed" && (
        <p className="note">
          <a href="#signin" onClick={onDone}>
            Go to sign in
          </a>
        </p>
      )}
    </>
  );
}
