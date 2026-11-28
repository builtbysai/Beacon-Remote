import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api.js";

type Relationship = {
  id: string;
  helperEmail: string;
  capability: "desktop:view" | "desktop:control";
  // Null for a share that comes from the team: it has no expiry of its own.
  expiresAtMillis: number | null;
  team?: boolean;
};

const dayLabel = (millis: number) =>
  new Date(millis).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// People the owner has chosen to let request this computer again (ADR 0024). Each session still
// asks on the computer, and removing someone ends their session at once.
export function SupportAccess({
  machineId,
  controlEnabled,
  disabled,
}: {
  machineId: string;
  controlEnabled: boolean;
  disabled: boolean;
}) {
  const [list, setList] = useState<Relationship[] | null>(null);
  const [email, setEmail] = useState("");
  const [capability, setCapability] =
    useState<Relationship["capability"]>("desktop:view");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A failed load is not an empty list: who has access stays as last known (or unknown), with a way to retry.
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ relationships: Relationship[] }>(
        `machines/${machineId}/relationships`,
      );
      setList(result.relationships);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [machineId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`machines/${machineId}/relationships`, {
        email: email.trim(),
        capability,
        days,
      });
      setEmail("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? "This computer is already shared with the most helpers it allows. Remove one first."
          : "Could not share with that account. Check the email address.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`relationships/${id}/revoke`, {});
      await load();
    } catch {
      setError("Could not remove that access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inspector-detail-group">
      <h3>Support access</h3>
      <p className="note">
        People you name can ask to connect until the date shown. You approve
        each connection on the computer unless helpers are remembered there.
      </p>
      {list?.length ? (
        <ul className="support-list">
          {list.map((entry) => (
            <li key={entry.id}>
              <span>
                {entry.helperEmail}
                <small>
                  {entry.capability === "desktop:control"
                    ? "View and control"
                    : "View only"}{" "}
                  ·{" "}
                  {entry.expiresAtMillis === null
                    ? "from your team"
                    : `until ${dayLabel(entry.expiresAtMillis)}`}
                </small>
              </span>
              {entry.team ? (
                <small>Change in Settings, Team</small>
              ) : (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void remove(entry.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : list ? (
        <p className="note">No one has support access.</p>
      ) : null}
      {loadFailed && (
        <p className="note" role="alert">
          {list
            ? "Couldn’t refresh who has access; showing the last list. "
            : "Couldn’t load who has support access. "}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Try again
          </button>
        </p>
      )}
      {!disabled && (
        <form className="support-form" onSubmit={add}>
          <label>
            Their account email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <div className="support-form-row">
            <label>
              Access
              <select
                value={capability}
                onChange={(event) =>
                  setCapability(
                    event.target.value as Relationship["capability"],
                  )
                }
              >
                <option value="desktop:view">View only</option>
                {controlEnabled && (
                  <option value="desktop:control">View and control</option>
                )}
              </select>
            </label>
            <label>
              For
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !email.trim()}>
            Allow support access
          </button>
        </form>
      )}
    </div>
  );
}
