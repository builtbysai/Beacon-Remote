import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api.js";

type Member = {
  id: string;
  email: string;
  role: "viewer" | "technician";
  group: string | null;
  computers: number;
};

// The people who may help with this account's computers (ADR 0037): all of them or one group, as a viewer or a
// technician. Each computer still asks its own person, and the shares appear on each computer's own list.
export function TeamPanel() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("viewer");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [team, machines, config] = await Promise.all([
        api<{ members: Member[] }>("team"),
        api<{ machines: { group: string | null }[] }>("machines"),
        api<{ controlEnabled?: boolean }>("media/config"),
      ]);
      setMembers(team.members);
      setGroups(
        [
          ...new Set(
            machines.machines.map((machine) => machine.group).filter(Boolean),
          ),
        ].sort() as string[],
      );
      setControlEnabled(config.controlEnabled === true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("team", { email: email.trim(), role, group: group || null });
      setEmail("");
      await load();
      setNotice("Team access saved.");
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? "The team is full. Remove someone first."
          : "Could not add that account. They need a Beacon Remote account of their own.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`team/${id}/remove`, {});
      await load();
      setNotice("Team access removed.");
    } catch {
      setError("Could not remove that person.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quiet-panel">
      <h2>Team</h2>
      <p>Give a trusted account access to every computer or one group.</p>
      {loadError && (
        <p className="error" role="alert">
          Couldn’t refresh team access.{" "}
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            Try again
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading && members === null ? (
        <p role="status">Loading team access…</p>
      ) : members?.length ? (
        <ul className="support-list">
          {members.map((member) => (
            <li key={member.id}>
              <span>
                {member.email}
                <small>
                  {member.role === "technician" ? "Technician" : "Viewer"} ·{" "}
                  {member.group ? `group ${member.group}` : "all computers"} ·{" "}
                  {member.computers}{" "}
                  {member.computers === 1 ? "computer" : "computers"}
                </small>
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void remove(member.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : !loadError ? (
        <p className="note">No one is on your team.</p>
      ) : null}
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
            Role
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as Member["role"])
              }
            >
              <option value="viewer">Viewer (watch only)</option>
              {controlEnabled && (
                <option value="technician">
                  Technician (watch and control)
                </option>
              )}
            </select>
          </label>
          <label>
            Computers
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="">All computers</option>
              {groups.map((name) => (
                <option key={name} value={name}>
                  Group {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || loading || loadError || !email.trim()}
        >
          {busy ? "Saving…" : "Add to team"}
        </button>
        <p className="note">
          Adding an existing member updates their role or group.
        </p>
      </form>
    </div>
  );
}
