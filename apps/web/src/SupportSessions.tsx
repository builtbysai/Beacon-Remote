import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api.js";
import type { ViewGrant } from "./LiveView.js";
import { SupportSessionPanel } from "./SupportSessionPanel.js";

type Capability = "desktop:view" | "desktop:control";
type Link = {
  id: string;
  label: string | null;
  capability: Capability;
  state: "waiting" | "connected" | "offline" | "ended" | "expired";
  endedBy: "technician" | "recipient" | "expired" | null;
  machineId: string | null;
  name: string | null;
  expiresAtMillis: number;
  untilMillis: number | null;
  notes: string | null;
};

const STATE_TEXT: Record<Link["state"], string> = {
  waiting: "Waiting for them to open the link",
  connected: "Ready · waiting for you to connect",
  offline: "Their support program isn't responding",
  ended: "Finished",
  expired: "Link expired unused",
};

// A technician's support queue (ADR 0038): make a one-use link, send it, and connect when the person has run it.
export function SupportSessions({
  onClaimed,
  sessionActive,
}: {
  onClaimed: (grant: ViewGrant, name: string) => void;
  sessionActive: boolean;
}) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [label, setLabel] = useState("");
  const [control, setControl] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks((await api<{ links: Link[] }>("support-links")).links);
    } catch {
      setLinks([]);
    }
  }, []);
  useEffect(() => {
    void load();
    api<{ controlEnabled?: boolean }>("media/config")
      .then((config) => setControlEnabled(config.controlEnabled === true))
      .catch(() => undefined);
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const made = await api<{ url: string }>("support-links", {
        capability:
          control && controlEnabled ? "desktop:control" : "desktop:view",
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setFresh(made.url);
      setLabel("");
      await load();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? "You have too many open support links. End one first."
          : "Could not create the link. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      setError("Copy failed. Select the link and copy it.");
    }
  }
  async function end(id: string) {
    setBusy(true);
    try {
      await api(`support-links/${id}/end`, {});
      await load();
    } catch {
      setError("Could not end that support session.");
    } finally {
      setBusy(false);
    }
  }
  async function connect(link: Link, capability: Capability) {
    if (!link.machineId || sessionActive || busy) return;
    setBusy(true);
    setError("");
    try {
      const grant = await api<ViewGrant>(
        `machines/${link.machineId}/sessions`,
        { source: "desktop", capability },
      );
      onClaimed(grant, link.name ?? "Support session");
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? "That computer is already in a session."
          : "Could not connect. Their support program may have closed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const open = (links ?? []).filter(
    (link) => link.state !== "ended" && link.state !== "expired",
  );
  const done = (links ?? []).filter(
    (link) => link.state === "ended" || link.state === "expired",
  );
  return (
    <section className="workspace-panel support-queue">
      <div className="workspace-panel-heading">
        <h2>Support sessions</h2>
      </div>
      <div className="assist-panel-body">
        <p>
          Make a link and send it by text, email or chat. The person downloads
          and runs a small temporary program, then allows you in. Nothing stays
          on their computer afterwards.
        </p>
        <form className="support-form" onSubmit={create}>
          <label>
            Who is this for (optional)
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={60}
              placeholder="Mum's laptop"
              autoComplete="off"
            />
          </label>
          {controlEnabled && (
            <label className="check">
              <input
                type="checkbox"
                checked={control}
                onChange={(event) => setControl(event.target.checked)}
              />{" "}
              Also ask to control their computer
            </label>
          )}
          <button type="submit" disabled={busy}>
            New support session
          </button>
        </form>
        {fresh && (
          <div className="support-fresh">
            <input readOnly value={fresh} aria-label="Support link" />
            <button type="button" className="secondary" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <p className="note">
              Works once and expires in 24 hours. Anyone with the link can start
              the session, so send it only to the person you are helping.
            </p>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {open.length > 0 && (
          <ul className="support-list">
            {open.map((link) => (
              <li key={link.id}>
                <span>
                  {link.name ?? link.label ?? "Support link"}
                  <small>
                    {link.label && link.name ? `${link.label} · ` : ""}
                    {STATE_TEXT[link.state]} ·{" "}
                    {link.capability === "desktop:control"
                      ? "view and control"
                      : "view only"}
                  </small>
                </span>
                <span className="support-actions">
                  {link.state === "connected" && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy || sessionActive}
                        onClick={() => void connect(link, "desktop:view")}
                      >
                        View
                      </button>
                      {link.capability === "desktop:control" && (
                        <button
                          disabled={busy || sessionActive}
                          onClick={() => void connect(link, "desktop:control")}
                        >
                          Control
                        </button>
                      )}
                    </>
                  )}
                  {link.machineId && (
                    <button
                      className="secondary"
                      onClick={() =>
                        setOpened(opened === link.id ? null : link.id)
                      }
                    >
                      {opened === link.id ? "Hide" : "Chat and notes"}
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void end(link.id)}
                  >
                    {link.state === "waiting" ? "Cancel" : "End support"}
                  </button>
                </span>
                {opened === link.id && link.machineId && (
                  <SupportSessionPanel
                    machineId={link.machineId}
                    linkId={link.id}
                    notes={link.notes ?? ""}
                    onHandedOver={() => {
                      setOpened(null);
                      void load();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details className="support-history">
            <summary>Recent ({done.length})</summary>
            <ul className="support-list">
              {done.map((link) => (
                <li key={link.id}>
                  <span>
                    {link.name ?? link.label ?? "Support link"}
                    <small>
                      {link.notes ? `${link.notes.slice(0, 80)} · ` : ""}
                      {link.state === "expired"
                        ? STATE_TEXT.expired
                        : `Ended by ${
                            link.endedBy === "recipient"
                              ? "them"
                              : link.endedBy === "expired"
                                ? "the time limit"
                                : "you"
                          }`}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
