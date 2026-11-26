import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Machine } from "@beacon-remote/protocol";
import "./style.css";
import "./viewer.css";
import { LiveView, type ViewGrant } from "./LiveView.js";
import { SignInView } from "./SignInView.js";
import { Brand, ProductPage, pageFromHash } from "./Product.js";
import { Character, toneFor } from "./Characters.js";
import { api, ApiError } from "./api.js";
import { AccountPanels } from "./AccountPanels.js";
import { PairComputer } from "./PairComputer.js";
import { SessionHistory } from "./SessionHistory.js";
import { ComputerInspector } from "./ComputerInspector.js";
import { AssistPanel } from "./AssistPanel.js";
import { SupportInvite } from "./SupportInvite.js";
import { AccountMenu } from "./AccountMenu.js";
import { ThemePicker, readTheme, saveTheme } from "./ThemePicker.js";
import { WorkspaceIcon, workspaceItems } from "./WorkspaceIcon.js";
import { resolveViewRequest } from "./view-request.js";
import { readView, forgetView } from "./resume-view.js";
import {
  waitForRestartAccess,
  type RestartStage,
} from "./restart-reconnect.js";
import {
  ForgotForm,
  SignupForm,
  VerifyEmail,
  useEntryConfig,
} from "./AccountEntry.js";

// Fragments stay out of HTTP/access logs; remove the bearer from browser history.
const invitation = new URLSearchParams(window.location.hash.slice(1)).get(
  "invite",
);
const recovery = new URLSearchParams(window.location.hash.slice(1)).get(
  "recover",
);
const verification = new URLSearchParams(window.location.hash.slice(1)).get(
  "verify",
);
if (invitation || recovery || verification)
  window.history.replaceState(null, "", window.location.pathname);

// A technician's support link: the token stays in the address so a reload keeps the page working.
function supportFromHash(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get(
    "support",
  );
  return token && /^[A-Za-z0-9_-]{32}$/.test(token) ? token : null;
}

function lastSeen(iso: string): string {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function App() {
  type SignInIntent = {
    machineId: string;
    name: string;
    abort: AbortController;
    restart?: { active: boolean; abort: AbortController };
  };
  const signInContext = useRef<SignInIntent | null>(null);
  const pairingRefresh = useRef<AbortController | null>(null);
  const assistEpoch = useRef(0);
  const knownSignedIn = useRef(false);
  const [signInView, setSignInView] = useState<SignInIntent | null>(null);
  function closeSignIn() {
    signInContext.current?.abort.abort();
    signInContext.current = null;
    setSignInView(null);
  }
  const viewContext = useRef({ active: false });
  const recoveryAttempted = useRef(false);
  const manualViewEpoch = useRef(0);
  const restartContext = useRef({
    active: false,
    abort: new AbortController(),
  });
  const [restarting, setRestarting] = useState<{
    name: string;
    stage: RestartStage;
  } | null>(null);
  const [page, setPage] = useState(pageFromHash);
  const [supportToken, setSupportToken] = useState(supportFromHash);
  const [theme, setTheme] = useState(readTheme);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [publicMenuOpen, setPublicMenuOpen] = useState(false);
  useEffect(() => {
    const change = () => {
      assistEpoch.current++;
      closeSignIn();
      pairingRefresh.current?.abort();
      cancelRestart();
      viewContext.current.active = false;
      const hash = window.location.hash;
      setEntry(
        hash === "#signup" ? "signup" : hash === "#forgot" ? "forgot" : null,
      );
      setSupportToken(supportFromHash());
      setSupportToken(supportFromHash());
      setPage(pageFromHash());
      setPairOpen(false);
      setPublicMenuOpen(false);
      setSelected(null);
      setError("");
      setChallenge(null);
      setUnconfirmed(false);
      setShowPassword(false);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    saveTheme(theme);
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (preference.matches ? "dark" : "light") : theme;
    };
    apply();
    preference.addEventListener("change", apply);
    return () => preference.removeEventListener("change", apply);
  }, [theme]);
  const [invite, setInvite] = useState(invitation);
  const [recoverToken, setRecoverToken] = useState(recovery);
  const [recovered, setRecovered] = useState(false);
  const [verifyToken, setVerifyToken] = useState(verification);
  const [entry, setEntry] = useState<"signup" | "forgot" | null>(() =>
    window.location.hash === "#signup"
      ? "signup"
      : window.location.hash === "#forgot"
        ? "forgot"
        : null,
  );
  const [unconfirmed, setUnconfirmed] = useState(false);
  const entryConfig = useEntryConfig();
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [error, setError] = useState("");
  const [pairOpen, setPairOpen] = useState(false);
  const addComputer = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [, setClock] = useState(Date.now());
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [view, setView] = useState<{
    grant: ViewGrant;
    name: string;
    machineId?: string;
    displayId?: string;
  } | null>(null);
  useEffect(() => {
    setView(null);
    setError("");
  }, [page]);
  const signedIn = machines !== null;
  knownSignedIn.current = signedIn;
  const assistGeneration = assistEpoch.current;
  useEffect(
    () => () => {
      pairingRefresh.current?.abort();
      restartContext.current.active = false;
      restartContext.current.abort.abort();
      signInContext.current?.abort.abort();
      signInContext.current = null;
      viewContext.current.active = false;
    },
    [page, signedIn],
  );
  function cancelRestart() {
    manualViewEpoch.current++;
    if (signInContext.current?.restart === restartContext.current)
      closeSignIn();
    restartContext.current.active = false;
    restartContext.current.abort.abort();
    setRestarting(null);
  }
  async function reconnectAfterRestart(
    machine: Machine,
    previousInstance: string | null,
  ) {
    if (!viewContext.current.active) return;
    cancelRestart();
    const context = { active: true, abort: new AbortController() };
    // Discard in-flight requests/resume replies from before the restart intent.
    viewContext.current.active = false;
    const pageContext = { active: true };
    viewContext.current = pageContext;
    restartContext.current = context;
    const isCurrent = () =>
      context.active && pageContext.active && !context.abort.signal.aborted;
    const capability =
      view?.machineId === machine.id
        ? (view.grant.capability ?? "desktop:view")
        : "desktop:control";
    const displayId =
      view?.machineId === machine.id ? view.displayId : undefined;
    setRestarting({ name: machine.name, stage: "restarting" });
    setError("");
    const previous = view;
    setView(null);
    forgetView();
    if (previous)
      void api(`sessions/${previous.grant.id}/stop`, {}).catch(() => {});
    try {
      const destination = await waitForRestartAccess({
        machineId: machine.id,
        previousInstance,
        capability,
        isCurrent,
        progress: (stage) => {
          if (isCurrent()) setRestarting({ name: machine.name, stage });
        },
        observeSignIn: controlEnabled
          ? () =>
              api<unknown>(
                `machines/${machine.id}/signin-authority`,
                undefined,
                AbortSignal.any([
                  context.abort.signal,
                  AbortSignal.timeout(3000),
                ]),
              )
          : undefined,
        observe: async () =>
          (
            await api<{ machines: Machine[] }>(
              "machines",
              undefined,
              AbortSignal.any([
                context.abort.signal,
                AbortSignal.timeout(15000),
              ]),
            )
          ).machines,
      });
      if (!destination || !isCurrent()) return;
      const ready = destination.machine;
      if (destination.kind === "sign-in") {
        const abort = new AbortController();
        context.abort.signal.addEventListener("abort", () => abort.abort(), {
          once: true,
          signal: abort.signal,
        });
        const intent = {
          machineId: ready.id,
          name: ready.name,
          abort,
          restart: context,
        };
        signInContext.current = intent;
        setSignInView(intent);
        return;
      }
      const grant = await api<ViewGrant>(`machines/${machine.id}/sessions`, {
        source: "desktop",
        capability,
        requirePolicy: true,
        ...(displayId ? { displayId } : {}),
      });
      await resolveViewRequest(
        Promise.resolve(grant),
        () => isCurrent() && grant.approval === "policy",
        (accepted) =>
          setView({
            grant: accepted,
            name: ready.name,
            machineId: ready.id,
            displayId,
          }),
        (unused) => api(`sessions/${unused.id}/stop`, {}),
      );
      if (isCurrent() && grant.approval !== "policy")
        throw new Error(
          "Reconnect stopped because unattended permission changed.",
        );
    } catch (failure) {
      if (isCurrent())
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not reconnect after restart.",
        );
    } finally {
      if (restartContext.current === context) {
        context.active = false;
        setRestarting(null);
      }
    }
  }
  function restartCallback(machine: Machine) {
    const epoch = manualViewEpoch.current;
    return (previousInstance: string | null) => {
      if (epoch === manualViewEpoch.current && viewContext.current.active)
        void reconnectAfterRestart(machine, previousInstance);
    };
  }
  useEffect(() => {
    const context = { active: signedIn && page === "computers" };
    viewContext.current = context;
    return () => {
      context.active = false;
    };
  }, [page, signedIn]);
  useEffect(() => {
    const context = viewContext.current;
    if (!context.active || recoveryAttempted.current) return;
    recoveryAttempted.current = true;
    const previous = readView();
    if (!previous) return;
    void resolveViewRequest(
      api<ViewGrant>(`sessions/${previous.id}/resume`, {}),
      () => context.active,
      (grant) => setView({ grant, name: previous.name }),
      (unused) => api(`sessions/${unused.id}/stop`, {}),
    ).catch(() => forgetView());
  }, [page, signedIn]);
  const workspaceOpen =
    signedIn && page !== "home" && page !== "support" && page !== "security";
  const entryVisible =
    !supportToken &&
    (Boolean(invite || recoverToken || verifyToken) ||
      page === "signin" ||
      (!signedIn &&
        ["computers", "sessions", "assist", "activity", "settings"].includes(
          page,
        )));
  useEffect(() => {
    if (!publicMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPublicMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [publicMenuOpen]);
  useEffect(() => {
    let disposed = false;
    if (signedIn)
      void api<{ enabled: boolean; controlEnabled?: boolean }>("media/config")
        .then((data) => {
          if (!disposed) {
            setMediaEnabled(data.enabled);
            setControlEnabled(data.controlEnabled === true);
          }
        })
        .catch(() => {
          if (!disposed) {
            setMediaEnabled(false);
            setControlEnabled(false);
          }
        });
    else {
      setMediaEnabled(false);
      setControlEnabled(false);
      setView(null);
    }
    return () => {
      disposed = true;
    };
  }, [signedIn]);

  // Moves the viewer to another display. Each display is approved on its own, so this ends the current session and
  // asks for a new one on that display; the person at the computer is asked again unless their own policy allows it.
  async function switchDisplay(displayId: string) {
    if (!view?.machineId || displayId === view.displayId) return;
    const machine = machines?.find((entry) => entry.id === view.machineId);
    if (!machine) return;
    const capability = view.grant.capability ?? "desktop:view";
    try {
      await api(`sessions/${view.grant.id}/stop`, {});
    } catch {
      // Already ended; a new one can still be requested.
    }
    setView(null);
    await testVideo(machine, capability, displayId);
  }

  async function testVideo(
    machine: Machine,
    capability: "desktop:view" | "desktop:control" = "desktop:view",
    displayId?: string,
  ) {
    if (signInContext.current) {
      setError("End Windows sign-in control before opening another session.");
      return;
    }
    cancelRestart();
    const context = viewContext.current;
    if (!context.active) return;
    setBusy(true);
    setError("");
    try {
      await resolveViewRequest(
        api<ViewGrant>(`machines/${machine.id}/sessions`, {
          source: "desktop",
          capability,
          ...(displayId ? { displayId } : {}),
        }),
        () => context.active,
        (grant) =>
          setView({
            grant,
            name: machine.name,
            machineId: machine.id,
            displayId,
          }),
        (unused) => api(`sessions/${unused.id}/stop`, {}),
      );
    } catch {
      if (context.active)
        setError(
          "Could not start video. Check that your computer is online and no session is active.",
        );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      const epoch = assistEpoch.current;
      try {
        const data = await api<{ machines: Machine[] }>("machines");
        if (!disposed && epoch === assistEpoch.current) {
          setMachines(data.machines);
          setStale(false);
        }
      } catch (failure) {
        if (!disposed && epoch === assistEpoch.current) {
          setStale(true);
          if (
            failure instanceof Error &&
            failure.message === "Please sign in."
          ) {
            viewContext.current.active = false;
            setView(null);
            setMachines(null);
            if (knownSignedIn.current) assistEpoch.current++;
            knownSignedIn.current = false;
            closeSignIn();
          }
        }
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => {
      setClock(Date.now());
      void refresh();
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const epoch = assistEpoch.current;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (invite) {
        await api("account/setup", {
          token: invite,
          email: form.get("email"),
          password: form.get("password"),
        });
        if (epoch !== assistEpoch.current) return;
        setInvite(null);
      }
      const response = await api<{
        ok?: true;
        mfaRequired?: true;
        challenge?: string;
      }>("login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      if (epoch !== assistEpoch.current) return;
      if (response.mfaRequired && response.challenge) {
        setChallenge(response.challenge);
        return;
      }
      await finishSignIn(epoch);
    } catch (failure) {
      if (epoch !== assistEpoch.current) return;
      setUnconfirmed(failure instanceof ApiError && failure.status === 403);
      setError(
        failure instanceof ApiError && failure.status === 429
          ? failure.message
          : failure instanceof ApiError && failure.status === 403
            ? "Confirm your email first. We sent you a link when you signed up."
            : invite
              ? "Account setup failed. Check your details and invitation, then try again."
              : "Sign-in failed. Check your details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recoverPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const epoch = assistEpoch.current;
    const password = String(
      new FormData(event.currentTarget).get("password") ?? "",
    );
    setBusy(true);
    setError("");
    try {
      await api("account/recover", { token: recoverToken, password });
      if (epoch !== assistEpoch.current) return;
      setRecoverToken(null);
      setRecovered(true);
    } catch {
      if (epoch !== assistEpoch.current) return;
      setError(
        "That recovery link did not work. It may have expired or been used; ask for a new one.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finishSignIn(epoch = assistEpoch.current) {
    if (epoch !== assistEpoch.current) return;
    const result = await api<{ machines: Machine[] }>("machines");
    if (epoch !== assistEpoch.current) return;
    assistEpoch.current++;
    setMachines(result.machines);
    setStale(false);
    window.location.hash = [
      "computers",
      "sessions",
      "assist",
      "activity",
      "settings",
    ].includes(page)
      ? page
      : "computers";
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const epoch = assistEpoch.current;
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setBusy(true);
    setError("");
    try {
      await api("login/mfa", { challenge, code });
      if (epoch !== assistEpoch.current) return;
      setChallenge(null);
      await finishSignIn(epoch);
    } catch {
      if (epoch !== assistEpoch.current) return;
      setError("That code did not work. Try again, or use a recovery code.");
    } finally {
      setBusy(false);
    }
  }

  async function paired(id: string | null) {
    pairingRefresh.current?.abort();
    const controller = new AbortController();
    pairingRefresh.current = controller;
    try {
      const result = await api<{ machines: Machine[] }>(
        "machines",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setMachines(result.machines);
      // Below 1100px the inspector is a modal sheet; it would cover the
      // pairing confirmation, so only open it beside the list.
      if (
        id &&
        window.matchMedia("(min-width: 1101px)").matches &&
        result.machines.some((machine) => machine.id === id)
      )
        setSelected(id);
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Computer paired, but the list could not refresh. Try refreshing the page.",
        );
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`machines/${id}/revoke`, {});
      const result = await api<{ machines: Machine[] }>("machines");
      setMachines(result.machines);
    } catch {
      setError("Could not revoke this computer.");
      throw new Error("Could not revoke this computer.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    assistEpoch.current++;
    closeSignIn();
    cancelRestart();
    try {
      await api("logout", {});
      forgetView();
      viewContext.current.active = false;
      setView(null);
      setMachines(null);
      setPairOpen(false);
    } catch {
      setError("Could not sign out. Please try again.");
    }
  }

  const visibleMachines = (machines ?? []).filter(
    (machine) =>
      // Temporary support computers live in Assist, not in the everyday list.
      !machine.temporary &&
      (machine.name + " " + (machine.group ?? ""))
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (groupFilter === "" || machine.group === groupFilter) &&
      // Revoked computers stay out of the everyday list; they have their own filter.
      (filter === "all"
        ? !machine.revokedAt
        : (machine.revokedAt
            ? "revoked"
            : !stale && machine.online
              ? "online"
              : "offline") === filter),
  );
  const groups = [
    ...new Set(
      (machines ?? [])
        .filter((machine) => !machine.revokedAt && machine.group)
        .map((machine) => machine.group as string),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const statusCounts = {
    all: (machines ?? []).filter(
      (machine) => !machine.temporary && !machine.revokedAt,
    ).length,
    online: (machines ?? []).filter(
      (machine) =>
        !machine.temporary && !machine.revokedAt && !stale && machine.online,
    ).length,
    offline: (machines ?? []).filter(
      (machine) =>
        !machine.temporary && !machine.revokedAt && (stale || !machine.online),
    ).length,
    revoked: (machines ?? []).filter(
      (machine) => !machine.temporary && machine.revokedAt,
    ).length,
  };
  const activeCount = (machines ?? []).filter(
    (machine) => !machine.revokedAt,
  ).length;
  const onlineCount = (machines ?? []).filter(
    (machine) => !machine.revokedAt && machine.online,
  ).length;

  return (
    <main className={workspaceOpen ? "app-shell" : "public-shell"}>
      {workspaceOpen ? (
        <header className="workspace-topbar">
          <Brand />
          <nav className="workspace-nav" aria-label="Workspace">
            {workspaceItems.map((item) => (
              <a
                key={item.page}
                className="workspace-nav-link"
                href={`#${item.page}`}
                aria-current={page === item.page ? "page" : undefined}
              >
                <WorkspaceIcon name={item.page} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="header-end">
            <ThemePicker theme={theme} onChange={setTheme} />
            <AccountMenu page={page} onSignOut={() => void logout()} />
          </div>
        </header>
      ) : (
        <header>
          <Brand />
          <nav
            id="public-nav"
            className={publicMenuOpen ? "public-nav open" : "public-nav"}
            aria-label="Public navigation"
            onClick={() => setPublicMenuOpen(false)}
          >
            <a href="#downloads">Download</a>
            <a href="#support">Support</a>
            <a href="#security">Security</a>
          </nav>
          <div className="header-end">
            <ThemePicker theme={theme} onChange={setTheme} />
            <a
              className="button header-workspace"
              href={signedIn ? "#computers" : "#signin"}
            >
              {signedIn ? "Open workspace" : "Sign in"}
            </a>
            <button
              className="public-menu-toggle"
              aria-label={publicMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={publicMenuOpen}
              aria-controls="public-nav"
              onClick={() => setPublicMenuOpen(!publicMenuOpen)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path
                  d={
                    publicMenuOpen ? "M5 5l14 14M19 5L5 19" : "M4 8h16M4 16h16"
                  }
                />
              </svg>
            </button>
          </div>
        </header>
      )}
      {supportToken ? (
        <SupportInvite token={supportToken} />
      ) : !invite &&
        !recoverToken &&
        !verifyToken &&
        page !== "signin" &&
        !(
          ["computers", "sessions", "assist", "activity", "settings"].includes(
            page,
          ) && !signedIn
        ) &&
        page !== "computers" ? (
        page === "sessions" ? (
          <SessionHistory />
        ) : page === "assist" ? (
          <>
            <AssistPanel
              sessionActive={view !== null}
              onClaimed={(grant, name) => {
                if (
                  assistEpoch.current !== assistGeneration ||
                  window.location.hash !== "#assist" ||
                  !signedIn
                ) {
                  return false;
                }
                setView({ grant, name });
                return true;
              }}
            />
            {view && (
              <LiveView
                key={view.grant.id}
                grant={view.grant}
                name={view.name}
                onClose={() => setView(null)}
              />
            )}
          </>
        ) : page === "settings" || page === "activity" ? (
          <AccountPanels
            activity={page === "activity"}
            theme={theme}
            onTheme={setTheme}
          />
        ) : (
          <ProductPage page={page} signedIn={signedIn} />
        )
      ) : page === "signin" ||
        entry ||
        machines === null ||
        invite ||
        recoverToken ||
        verifyToken ? (
        <section className="login" aria-busy={busy}>
          <Character tone="blue" mood="wave" className="login-char" />
          {error && (
            <p id="entry-error" className="error" role="alert">
              {error}
            </p>
          )}
          {verifyToken ? (
            <VerifyEmail
              token={verifyToken}
              onDone={() => {
                if (assistEpoch.current !== assistGeneration) return;
                setVerifyToken(null);
                void finishSignIn(assistGeneration).catch(() => undefined);
              }}
            />
          ) : entry === "signup" ? (
            <SignupForm onSignIn={() => setEntry(null)} />
          ) : entry === "forgot" ? (
            <ForgotForm onSignIn={() => setEntry(null)} />
          ) : null}
          {!verifyToken && !entry && (
            <>
              <h1>
                {recoverToken
                  ? "New password"
                  : invite
                    ? "Create account"
                    : "Sign in"}
              </h1>
              {(recoverToken || recovered || invite) && (
                <p>
                  {recoverToken
                    ? "This link works once and expires in 30 minutes."
                    : recovered
                      ? "Password changed. Other browsers were signed out."
                      : "Use at least 16 characters. The invitation expires in 30 minutes."}
                </p>
              )}
              {recoverToken ? (
                <form key="recover" onSubmit={recoverPassword}>
                  <label>
                    New password
                    <input
                      name="password"
                      placeholder="16 characters or more"
                      type="password"
                      autoComplete="new-password"
                      minLength={16}
                      maxLength={512}
                      required
                      autoFocus
                    />
                  </label>
                  <button disabled={busy}>
                    {busy ? "Saving…" : "Save password"}
                  </button>
                </form>
              ) : challenge ? (
                <form key="mfa-code" onSubmit={submitCode}>
                  <label>
                    Authenticator or recovery code
                    <input
                      name="code"
                      autoComplete="one-time-code"
                      autoFocus
                      required
                    />
                  </label>
                  <button disabled={busy}>
                    {busy ? "Verifying…" : "Verify"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setChallenge(null);
                      setError("");
                    }}
                  >
                    Back
                  </button>
                </form>
              ) : (
                <form key="password" onSubmit={signIn}>
                  <label>
                    Email address
                    <input
                      name="email"
                      type="email"
                      autoComplete="username"
                      required
                    />
                  </label>
                  <label htmlFor="password">Password</label>
                  <span className="password-field">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        invite ? "new-password" : "current-password"
                      }
                      minLength={invite ? 16 : undefined}
                      maxLength={512}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </span>
                  <button disabled={busy}>
                    {busy
                      ? "Signing in…"
                      : invite
                        ? "Create account"
                        : "Sign in"}
                  </button>
                </form>
              )}
              {unconfirmed && entryConfig.open && (
                <p className="note">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEntry("signup")}
                  >
                    Resend confirmation link
                  </button>
                </p>
              )}
              <p className="note">
                {entryConfig.open ? (
                  <>
                    <a href="#signup" onClick={() => setEntry("signup")}>
                      Create account
                    </a>
                    {" · "}
                  </>
                ) : (
                  "Accounts are by invitation. "
                )}
                {entryConfig.emailRecovery ? (
                  <a href="#forgot" onClick={() => setEntry("forgot")}>
                    Forgot password?
                  </a>
                ) : (
                  "Forgot your password? Ask the operator for a recovery link."
                )}
              </p>
            </>
          )}
        </section>
      ) : (
        <section>
          <div className="heading">
            <div>
              <h1>Computers</h1>
              <p className="workspace-summary">
                {activeCount === 0
                  ? "Nothing paired yet"
                  : !stale
                    ? `${onlineCount} of ${activeCount} online`
                    : `${activeCount} ${activeCount === 1 ? "computer" : "computers"}`}
              </p>
            </div>
            <button
              ref={addComputer}
              onClick={() => setPairOpen(true)}
              disabled={busy || pairOpen}
            >
              Add a computer
            </button>
          </div>
          {restarting && (
            <div className="note restart-progress" role="status">
              <span>
                {restarting.stage === "restarting"
                  ? `Waiting for ${restarting.name} to restart…`
                  : restarting.stage === "waiting-for-windows"
                    ? `Waiting for Windows on ${restarting.name}…`
                    : restarting.stage === "sign-in-available"
                      ? `Windows sign-in is available on ${restarting.name}.`
                      : `Connecting to ${restarting.name}…`}
              </span>
              <button className="secondary" onClick={cancelRestart}>
                Cancel reconnect
              </button>
            </div>
          )}
          {stale && (
            <p role="status" className="notice warn">
              Connection lost. Status may be out of date.
            </p>
          )}
          {pairOpen && (
            <PairComputer
              onPaired={(id) => void paired(id)}
              onClose={() => {
                setPairOpen(false);
                requestAnimationFrame(() => addComputer.current?.focus());
              }}
            />
          )}
          {(machines.length > 0 || !pairOpen) && (
            <div
              className={
                selected
                  ? "inventory-layout with-inspector"
                  : "inventory-layout"
              }
            >
              <div className="grid">
                <div className="inventory-tools" hidden={machines.length === 0}>
                  <input
                    type="search"
                    aria-label="Search computers"
                    placeholder="Search computers"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setSelected(null);
                    }}
                  />
                  <div
                    className="filter-chips"
                    role="group"
                    aria-label="Computer status"
                  >
                    {(
                      [
                        ["all", "All"],
                        ["online", "Online"],
                        ["offline", "Offline"],
                        ["revoked", "Revoked"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className="chip"
                        aria-pressed={filter === value}
                        onClick={() => {
                          setFilter(value);
                          setSelected(null);
                        }}
                      >
                        {label}
                        <span>{statusCounts[value]}</span>
                      </button>
                    ))}
                  </div>
                  {groups.length > 0 && (
                    <select
                      aria-label="Computer group"
                      value={groupFilter}
                      onChange={(event) => {
                        setGroupFilter(event.target.value);
                        setSelected(null);
                      }}
                    >
                      <option value="">All groups</option>
                      {groups.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {machines.length === 0 && (
                  <div className="inventory-empty">
                    <Character
                      tone="blue"
                      mood="asleep"
                      className="empty-char"
                    />
                    <h2>No computers yet</h2>
                    <p>Pair a Windows or Android device to see it here.</p>
                  </div>
                )}
                {machines.length > 0 && visibleMachines.length === 0 && (
                  <div className="inventory-empty">
                    <h2>No matching computers</h2>
                    <p>Try a different search or filter.</p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setSearch("");
                        setFilter("all");
                        setGroupFilter("");
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                {visibleMachines.length > 0 && (
                  <div className="device-head" aria-hidden="true">
                    <span>Computer</span>
                    <span>Access</span>
                    <span>Last seen</span>
                  </div>
                )}
                {visibleMachines.map((machine) => {
                  const live = machine.online && !stale && !machine.revokedAt;
                  const canView =
                    mediaEnabled && !busy && live && view === null;
                  return (
                    <article
                      key={machine.id}
                      className={`device-row${selected === machine.id ? " is-selected" : ""}`}
                    >
                      <span
                        className={`status-dot ${live ? "online" : "offline"}`}
                        role="img"
                        aria-label={
                          machine.revokedAt
                            ? "Access revoked"
                            : stale
                              ? "Status unavailable"
                              : machine.online
                                ? "Online"
                                : "Offline"
                        }
                      >
                        <Character
                          tone={toneFor(machine.id)}
                          mood={
                            live
                              ? "awake"
                              : machine.revokedAt
                                ? "locked"
                                : "asleep"
                          }
                        />
                      </span>
                      <button
                        id={`device-${machine.id}`}
                        className="device-name secondary"
                        onClick={() =>
                          setSelected(
                            selected === machine.id ? null : machine.id,
                          )
                        }
                        aria-expanded={selected === machine.id}
                      >
                        {machine.name}
                        {machine.group && (
                          <small className="device-group">
                            {machine.group}
                          </small>
                        )}
                      </button>
                      <span
                        className="device-access"
                        data-mode={
                          machine.revokedAt
                            ? "revoked"
                            : machine.accessMode === "trusted"
                              ? "trusted"
                              : "ask"
                        }
                      >
                        {machine.revokedAt
                          ? "Revoked"
                          : machine.accessMode === "trusted"
                            ? "Trusted"
                            : "Ask each time"}
                      </span>
                      <span className="device-seen">
                        {machine.revokedAt
                          ? "—"
                          : live
                            ? "Now"
                            : machine.bootState === "locked"
                              ? "Locked"
                              : machine.bootState === "signed-out"
                                ? "Sign-in needed"
                                : machine.bootState === "starting"
                                  ? "Starting host"
                                  : machine.lastSeenAt
                                    ? lastSeen(machine.lastSeenAt)
                                    : "Never"}
                      </span>
                      {live ? (
                        <button
                          className="device-open"
                          disabled={!canView}
                          onClick={() => {
                            // One click: ask for viewing and control together. The person at the
                            // computer sees both and can choose View only; nothing is granted until
                            // they approve. Open the details for a view-only request.
                            void testVideo(
                              machine,
                              controlEnabled
                                ? "desktop:control"
                                : "desktop:view",
                            );
                          }}
                          title={
                            !mediaEnabled
                              ? "Desktop access is unavailable on this server"
                              : controlEnabled
                                ? machine.accessMode === "trusted"
                                  ? "View and control; this computer is set to trusted access"
                                  : "View and control; requires approval on this device"
                                : "View only; requires approval on this device"
                          }
                        >
                          Connect
                        </button>
                      ) : (
                        <span />
                      )}
                    </article>
                  );
                })}
              </div>
              {selected &&
                machines.find((machine) => machine.id === selected) && (
                  <ComputerInspector
                    key={selected}
                    stale={stale}
                    viewEnabled={mediaEnabled}
                    controlEnabled={controlEnabled}
                    requesting={busy}
                    sessionActive={view !== null || signInView !== null}
                    onRequestSignIn={() => {
                      const machine = machines.find(
                        (entry) => entry.id === selected,
                      );
                      if (
                        !machine ||
                        machine.revokedAt ||
                        stale ||
                        busy ||
                        view ||
                        signInContext.current
                      )
                        return;
                      cancelRestart();
                      // A delayed ordinary-view resume cannot coexist with this
                      // separate privileged request context.
                      viewContext.current.active = false;
                      viewContext.current = { active: true };
                      forgetView();
                      const context = {
                        machineId: machine.id,
                        name: machine.name,
                        abort: new AbortController(),
                      };
                      signInContext.current = context;
                      setSignInView(context);
                    }}
                    onRequestView={(displayId) => {
                      void testVideo(
                        machines.find((machine) => machine.id === selected)!,
                        "desktop:view",
                        displayId,
                      );
                    }}
                    onRequestControl={(displayId) => {
                      void testVideo(
                        machines.find((machine) => machine.id === selected)!,
                        "desktop:control",
                        displayId,
                      );
                    }}
                    machine={machines.find(
                      (machine) => machine.id === selected,
                    )!}
                    onRestart={
                      !view || view.machineId === selected
                        ? restartCallback(
                            machines.find(
                              (machine) => machine.id === selected,
                            )!,
                          )
                        : undefined
                    }
                    onClose={() => {
                      setSelected(null);
                      document.getElementById(`device-${selected}`)?.focus();
                    }}
                    onUpdated={async () => {
                      const result = await api<{ machines: Machine[] }>(
                        "machines",
                      );
                      setMachines(result.machines);
                    }}
                    onRevoke={() => revoke(selected)}
                  />
                )}
            </div>
          )}
          {view && minimized && (
            <div className="live-pill" role="status">
              <span className="live-pill-dot" aria-hidden="true" />
              <span>
                <strong>{view.name}</strong> is connected
              </span>
              <button onClick={() => setMinimized(false)}>Return</button>
              <button
                className="live-pill-end"
                onClick={() => {
                  setView(null);
                  setMinimized(false);
                }}
              >
                End
              </button>
            </div>
          )}
          {view && (
            <LiveView
              key={view.grant.id}
              grant={view.grant}
              name={view.name}
              machineId={view.machineId}
              minimized={minimized}
              onMinimize={() => setMinimized(true)}
              onClose={() => {
                setView(null);
                setMinimized(false);
              }}
              displays={
                machines?.find((entry) => entry.id === view.machineId)
                  ?.displays ?? []
              }
              displayId={view.displayId}
              onSwitchDisplay={(id) => void switchDisplay(id)}
            />
          )}
          {signInView && (
            <SignInView
              key={signInView.machineId}
              machineId={signInView.machineId}
              name={signInView.name}
              signal={signInView.abort.signal}
              onClose={closeSignIn}
              onDesktop={(grant, transfer) => {
                if (
                  signInContext.current !== signInView ||
                  signInView.abort.signal.aborted ||
                  page !== "computers" ||
                  view !== null
                )
                  return false;
                transfer();
                closeSignIn();
                setView({
                  grant,
                  name: signInView.name,
                  machineId: signInView.machineId,
                });
                return true;
              }}
            />
          )}
        </section>
      )}
      {error && !entryVisible && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!workspaceOpen && (
        <footer>
          <span>Beacon Remote</span>
          <nav aria-label="Footer">
            <a href="#downloads">Download</a>
            <a href="#support">Support</a>
            <a href="#security">Security</a>
          </nav>
        </footer>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
