import { useEffect, useState } from "react";
import { api } from "./api.js";
import { useEntryConfig } from "./AccountEntry.js";

type Account = {
  email: string;
  createdAt: string;
  guestExpiresAt: string | null;
};
export function AccountIdentity() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const config = useEntryConfig();
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void api<Account>("account", undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAccount(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="quiet-panel account-identity">
      <h2>Account</h2>
      {error ? (
        <p className="error" role="alert">
          Couldn’t load your account.{" "}
          <button
            className="secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </p>
      ) : account ? (
        <dl>
          <dt>Email</dt>
          <dd>{account.email}</dd>
          <dt>{account.guestExpiresAt ? "Guest access expires" : "Joined"}</dt>
          <dd>
            <time dateTime={account.guestExpiresAt ?? account.createdAt}>
              {new Date(
                account.guestExpiresAt ?? account.createdAt,
              ).toLocaleDateString()}
            </time>
          </dd>
        </dl>
      ) : (
        <p role="status">Loading account…</p>
      )}
      {config.emailRecovery && account && !account.guestExpiresAt && (
        <a className="button secondary" href="#forgot">
          Reset password
        </a>
      )}
    </div>
  );
}
