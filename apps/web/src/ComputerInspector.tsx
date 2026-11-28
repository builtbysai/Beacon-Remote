import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMediaQuery, useModalSheet } from "./modal-sheet.js";
import {
  fromBase64url,
  keyFingerprint,
  type Machine,
} from "@beacon-remote/protocol";
import { api } from "./api.js";
import { activityLabel, type Activity } from "./AccountPanels.js";
import { sessionState, type SessionRecord } from "./SessionHistory.js";
import { WorkspaceIcon } from "./WorkspaceIcon.js";
import { SupportAccess } from "./SupportAccess.js";
import { DeviceActions } from "./DeviceActions.js";
import { SignInAccess } from "./SignInAccess.js";
import { Character, toneFor } from "./Characters.js";

// The short code of the computer's identity key (ADR 0061), to compare with the one in its own window.
function IdentityKeyRow({
  identityKey,
  removed,
  replacement,
}: {
  identityKey: string | undefined;
  removed: boolean;
  replacement: boolean;
}) {
  const [code, setCode] = useState("");
  useEffect(() => {
    const key = identityKey ? fromBase64url(identityKey) : null;
    if (!key || key.length !== 32) {
      setCode("");
      return;
    }
    let live = true;
    void keyFingerprint(key).then((value) => {
      if (live) setCode(value);
    });
    return () => {
      live = false;
    };
  }, [identityKey]);
  if (!code) return null;
  return (
    <>
      <div
        className="inspector-id"
        title="Compare this with the identity code in the Beacon Remote window on the computer"
      >
        <span>Identity key</span>
        <code>{code}</code>
      </div>
      {replacement && !removed && (
        <p className="inspector-note">
          This computer replaces a removed one with the same name, so its key
          code is new. That is expected, not a changed key; compare the code
          with the one in the Beacon Remote window on the computer.
        </p>
      )}
      {removed && (
        <p className="inspector-note">
          This computer was removed. Setting it up again makes a new entry with
          a new key code; that is expected, not a changed key.
        </p>
      )}
    </>
  );
}

export function ComputerInspector({
  machine,
  onClose,
  onUpdated,
  onRevoke,
  stale,
  onRequestView,
  onRequestControl,
  viewEnabled = false,
  controlEnabled = false,
  requesting = false,
  sessionActive = false,
  onRestart,
  onRequestSignIn,
  favourite,
  onToggleFavourite,
  replacesRemoved = false,
}: {
  machine: Machine;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onRevoke: () => Promise<void>;
  stale: boolean;
  onRequestView?: (displayId?: string) => void;
  onRequestControl?: (displayId?: string) => void;
  viewEnabled?: boolean;
  controlEnabled?: boolean;
  requesting?: boolean;
  sessionActive?: boolean;
  onRestart?: (previousInstance: string | null) => void;
  onRequestSignIn?: () => void;
  /** Whether a removed computer has this one's name (see computer-replacement.ts). */
  replacesRemoved?: boolean;
  // Starred computers are listed first (this browser only; grants nothing).
  favourite?: boolean;
  onToggleFavourite?: () => void;
}) {
  const [display, setDisplay] = useState("");
  const displays = machine.displays ?? [];
  // Only a display this computer reported can be chosen; otherwise the primary display is shared.
  const displayId = displays.some((entry) => entry.id === display)
    ? display
    : undefined;
  const [editing, setEditing] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  useEffect(() => {
    if (!editing && wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const [name, setName] = useState(machine.name);
  const [group, setGroup] = useState(machine.group ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "sharing" | "history" | "more">(
    "overview",
  );
  const historyOpen = tab === "history";
  const [copied, setCopied] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [history, setHistory] = useState<{
    events: Activity[];
    sessions: SessionRecord[];
    sessionsAvailable: boolean;
  } | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const unavailable = machine.revokedAt
    ? "Access revoked. Pair this computer again to connect."
    : stale
      ? "Status unavailable. Refresh before connecting."
      : !machine.online
        ? machine.bootState === "signed-out"
          ? "Sign in to Windows on this computer to make its desktop available."
          : machine.bootState === "locked"
            ? "Locked. The desktop is available after unlock."
            : machine.bootState === "starting"
              ? "Waiting for the desktop host to start."
              : "Offline. Check its power, network and host app."
        : sessionActive
          ? "End the current session first."
          : !viewEnabled
            ? "Desktop access is off on this server."
            : "";
  const cannotConnect = Boolean(unavailable) || requesting || busy;
  const trusted = machine.accessMode === "trusted";
  // Trusted access is switched on at the computer; from here it can only be switched off.
  async function lower(
    body:
      | { mode: "attended" }
      | { allowControl: false }
      | { helpers: "off" | "view" },
  ) {
    setBusy(true);
    setError("");
    try {
      await api(`machines/${machine.id}/access`, body);
      await onUpdated();
    } catch {
      setError("Could not change access.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!historyOpen) return;
    let disposed = false;
    setHistory(null);
    setHistoryLoading(true);
    setHistoryError("");
    const filter = `machineId=${encodeURIComponent(machine.id)}`;
    void Promise.all([
      api<{ events: Activity[] }>(`activity?${filter}`),
      api<{ available: boolean; sessions: SessionRecord[] }>(
        `sessions?${filter}`,
      ),
    ])
      .then(([activity, sessions]) => {
        if (!disposed)
          setHistory({
            events: activity.events,
            sessions: sessions.sessions,
            sessionsAvailable: sessions.available,
          });
      })
      .catch(() => {
        if (!disposed) setHistoryError("Could not load history.");
      })
      .finally(() => {
        if (!disposed) setHistoryLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [historyOpen, historyRefresh, machine.id, machine.revokedAt]);
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`machines/${machine.id}/name`, { name, group });
      await onUpdated();
      setEditing(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not rename computer.",
      );
    } finally {
      setBusy(false);
    }
  }
  const online = machine.online && !stale && !machine.revokedAt;
  const stateLabel = machine.revokedAt
    ? "Access revoked"
    : stale
      ? "Status unavailable"
      : machine.online
        ? "Online"
        : machine.bootState === "locked"
          ? "Locked"
          : machine.bootState === "signed-out"
            ? "Windows sign-in needed"
            : machine.bootState === "starting"
              ? "Starting desktop host"
              : "Offline";
  const accessLabel = trusted
    ? machine.allowControl
      ? "Trusted · view and control"
      : "Trusted · view only"
    : controlEnabled
      ? "Attended · view or control"
      : "Attended · view only";
  const panel = useRef<HTMLElement>(null);
  const sheet = useMediaQuery("(max-width: 1100px)");
  useModalSheet(panel, sheet);
  async function copyId() {
    try {
      await navigator.clipboard.writeText(machine.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn’t copy. Select the ID and copy it manually.");
    }
  }
  return (
    <aside
      ref={panel}
      className="device-inspector"
      aria-label="Computer details"
      // Shown as a bottom sheet over a dimmed page on narrow screens: a modal dialog there, a side panel otherwise.
      role={sheet ? "dialog" : undefined}
      aria-modal={sheet ? true : undefined}
      tabIndex={sheet ? -1 : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          if (editing) setEditing(false);
          else onClose();
        }
      }}
    >
      <div className="inspector-top">
        <Character
          className="inspector-char"
          tone={toneFor(machine.id)}
          mood={machine.revokedAt ? "locked" : online ? "awake" : "asleep"}
        />
        <div className="inspector-title">
          <h2 className="inspector-name" title={machine.name}>
            {machine.name}
          </h2>
          {onToggleFavourite && (
            <button
              type="button"
              className="inspector-favourite secondary"
              aria-pressed={Boolean(favourite)}
              title={
                favourite
                  ? "Remove from favourites"
                  : "Add to favourites (listed first)"
              }
              onClick={onToggleFavourite}
            >
              {favourite ? "★ Favourite" : "☆ Favourite"}
            </button>
          )}
          <p className={`inspector-state${online ? " is-online" : ""}`}>
            <span className="inspector-status-dot" aria-hidden="true" />
            {stateLabel}
          </p>
        </div>
        <div className="inspector-heading">
          <button
            className="secondary inspector-edit"
            ref={editButton}
            aria-label={`Edit ${machine.name}`}
            title="Rename"
            disabled={busy || Boolean(machine.revokedAt)}
            onClick={() => {
              setName(machine.name);
              setGroup(machine.group ?? "");
              setEditing(true);
            }}
          >
            <svg
              className="workspace-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
              <path d="m13.5 6.5 4 4" />
            </svg>
          </button>
          <button
            className="secondary"
            ref={closeButton}
            aria-label="Close computer details"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="inspector-rename"
          onSubmit={(event) => {
            void rename(event);
          }}
        >
          <label htmlFor="computer-name">Computer name</label>
          <input
            id="computer-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={1}
            maxLength={80}
            autoFocus
          />
          <label htmlFor="computer-group">Group (optional)</label>
          <input
            id="computer-group"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            maxLength={40}
            placeholder="Home, Office, Family…"
          />
          <div className="actions">
            <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {displays.length > 1 && (
        <label className="inspector-display">
          Display
          <select
            value={displayId ?? ""}
            onChange={(event) => setDisplay(event.target.value)}
          >
            <option value="">Primary display</option>
            {displays.map((entry, index) => (
              <option key={entry.id} value={entry.id}>
                Display {index + 1} · {entry.width}×{entry.height}
                {entry.primary ? " · Primary" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="inspector-command">
        <button
          disabled={cannotConnect || !controlEnabled || !onRequestControl}
          onClick={() => onRequestControl?.(displayId)}
          title={
            !controlEnabled
              ? "Control is off on this server"
              : trusted && machine.allowControl
                ? "Connect with control, no prompt"
                : "Request control; approve on the computer"
          }
        >
          <WorkspaceIcon name="computers" /> Connect
        </button>
        <button
          className="secondary"
          disabled={cannotConnect || !onRequestView}
          onClick={() => onRequestView?.(displayId)}
        >
          {requesting ? "Requesting…" : "View only"}
        </button>
      </div>
      {unavailable && (
        <p className="inspector-availability" role="status">
          {unavailable}
        </p>
      )}
      {onRequestSignIn && !machine.revokedAt && (
        <SignInAccess
          machineId={machine.id}
          disabled={stale || requesting || busy || sessionActive}
          onOpen={onRequestSignIn}
        />
      )}
      <div className="inspector-tabs" role="tablist" aria-label="Details">
        {(
          [
            ["overview", "Overview"],
            ["sharing", "Sharing"],
            ["history", "History"],
            ["more", "More"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`inspector-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`inspector-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "is-active" : undefined}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const order = ["overview", "sharing", "history", "more"] as const;
              const move =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (!move) return;
              event.preventDefault();
              const next = order[(order.indexOf(id) + move + 4) % 4]!;
              setTab(next);
              document.getElementById(`inspector-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div
          role="tabpanel"
          id="inspector-panel-overview"
          aria-labelledby="inspector-tab-overview"
          className="inspector-panel"
        >
          <dl className="facts">
            <div>
              <dt>Access</dt>
              <dd>{accessLabel}</dd>
            </div>
            {machine.helpersUnattended !== "off" && (
              <div>
                <dt>Helpers</dt>
                <dd>
                  {machine.helpersUnattended === "control"
                    ? "View and control"
                    : "View without asking"}
                </dd>
              </div>
            )}
            <div>
              <dt>Last seen</dt>
              <dd>
                {machine.lastSeenAt
                  ? new Date(machine.lastSeenAt).toLocaleString()
                  : "Never"}
              </dd>
            </div>
          </dl>
          {!machine.revokedAt &&
            (trusted || machine.helpersUnattended !== "off") && (
              <div className="actions">
                {machine.helpersUnattended === "control" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void lower({ helpers: "view" })}
                  >
                    Helpers: view only
                  </button>
                )}
                {machine.helpersUnattended !== "off" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void lower({ helpers: "off" })}
                  >
                    Helpers: always ask
                  </button>
                )}
                {trusted && machine.allowControl && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void lower({ allowControl: false })}
                  >
                    Turn off control
                  </button>
                )}
                {trusted && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void lower({ mode: "attended" })}
                  >
                    Ask for approval
                  </button>
                )}
              </div>
            )}
          {!trusted && !machine.revokedAt && (
            <p className="note">
              Trusted access is turned on from the computer itself.
            </p>
          )}
        </div>
      )}
      {tab === "sharing" && (
        <div
          role="tabpanel"
          id="inspector-panel-sharing"
          aria-labelledby="inspector-tab-sharing"
          className="inspector-panel"
        >
          <SupportAccess
            machineId={machine.id}
            controlEnabled={controlEnabled}
            disabled={Boolean(machine.revokedAt)}
          />
        </div>
      )}
      {tab === "history" && (
        <div
          role="tabpanel"
          id="inspector-panel-history"
          aria-labelledby="inspector-tab-history"
          className="inspector-panel"
        >
          <div className="inspector-history-bar">
            <h3>Recent activity</h3>
            <button
              className="secondary"
              disabled={historyLoading}
              onClick={() => setHistoryRefresh((value) => value + 1)}
            >
              {historyLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {historyError && (
            <p role="alert" className="error">
              {historyError}
            </p>
          )}
          {historyLoading && !history && <p role="status">Loading…</p>}
          {history && (
            <>
              {history.events.length ? (
                <ul className="timeline">
                  {history.events.slice(0, 6).map((event) => (
                    <li key={event.id}>
                      <strong>{activityLabel(event.action)}</strong>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="note">No activity yet.</p>
              )}
              <h3>Recent sessions</h3>
              {!history.sessionsAvailable ? (
                <p className="note">Session history is off on this server.</p>
              ) : history.sessions.length ? (
                <ul className="timeline">
                  {history.sessions.slice(0, 6).map((session) => (
                    <li key={session.id}>
                      <strong>{sessionState(session.status)}</strong>
                      <time dateTime={session.createdAt}>
                        {new Date(session.createdAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="note">No sessions yet.</p>
              )}
            </>
          )}
        </div>
      )}
      {tab === "more" && (
        <div
          role="tabpanel"
          id="inspector-panel-more"
          aria-labelledby="inspector-tab-more"
          className="inspector-panel"
        >
          <div className="inspector-id">
            <span>Device ID</span>
            <code>{machine.id}</code>
            <button className="secondary" onClick={() => void copyId()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <IdentityKeyRow
            identityKey={machine.identityKey}
            removed={Boolean(machine.revokedAt)}
            replacement={replacesRemoved}
          />
          <div className="inspector-manage">
            <DeviceActions
              machine={machine}
              onRevoke={onRevoke}
              onChanged={onUpdated}
              onRestart={onRestart}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
