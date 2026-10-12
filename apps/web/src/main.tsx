import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Machine } from "@beacon-remote/protocol";
import "./style.css";
import { LiveView, type ViewGrant } from "./LiveView.js";
import { Brand, Monitor, ProductPage, pageFromHash } from "./Product.js";
import { api, ApiError } from "./api.js";
import { AccountPanels } from "./AccountPanels.js";
import { SessionHistory } from "./SessionHistory.js";
import { ComputerInspector } from "./ComputerInspector.js";
import { WorkspaceIcon, workspaceItems } from "./WorkspaceIcon.js";

// Fragments stay out of HTTP/access logs; remove the bearer from browser history.
const invitation = new URLSearchParams(window.location.hash.slice(1)).get(
  "invite",
);
if (invitation) window.history.replaceState(null, "", window.location.pathname);

function App() {
  const [page, setPage] = useState(pageFromHash);
  const [theme, setTheme] = useState("system");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMore, setMobileMore] = useState(false);
  const [publicMenuOpen, setPublicMenuOpen] = useState(false);
  useEffect(() => {
    const change = () => {
      setPage(pageFromHash());
      setMobileMore(false);
      setPublicMenuOpen(false);
      setSelected(null);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
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
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(
    null,
  );
  const [codeCopied, setCodeCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [view, setView] = useState<{ grant: ViewGrant; name: string } | null>(
    null,
  );
  useEffect(() => {
    setView(null);
    setError("");
  }, [page]);
  const signedIn = machines !== null;
  const workspaceOpen =
    signedIn && page !== "home" && page !== "support" && page !== "security";
  useEffect(() => {
    if (!mobileMore) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMore(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMore]);
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
      void api<{ enabled: boolean }>("media/config")
        .then((data) => {
          if (!disposed) setMediaEnabled(data.enabled);
        })
        .catch(() => {
          if (!disposed) setMediaEnabled(false);
        });
    else {
      setMediaEnabled(false);
      setView(null);
    }
    return () => {
      disposed = true;
    };
  }, [signedIn]);

  async function testVideo(machine: Machine) {
    setBusy(true);
    setError("");
    try {
      const grant = await api<ViewGrant>(`machines/${machine.id}/sessions`, {
        source: "desktop",
      });
      setView({ grant, name: machine.name });
    } catch {
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
      try {
        const data = await api<{ machines: Machine[] }>("machines");
        if (!disposed) {
          setMachines(data.machines);
          setStale(false);
        }
      } catch (failure) {
        if (!disposed) {
          setStale(true);
          if (failure instanceof Error && failure.message === "Please sign in.")
            setMachines(null);
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
        setInvite(null);
      }
      await api("login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      const result = await api<{ machines: Machine[] }>("machines");
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
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 429
          ? failure.message
          : invite
            ? "Account setup failed. Check your details and invitation, then try again."
            : "Sign-in failed. Check your details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function pair() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ code: string; expiresInSeconds: number }>(
        "enrollments",
        {},
      );
      const issuedAt = Date.now();
      setClock(issuedAt);
      setCode({
        code: result.code,
        expiresAt: issuedAt + result.expiresInSeconds * 1000,
      });
      setCodeCopied(false);
    } catch {
      setError("Could not start pairing.");
    } finally {
      setBusy(false);
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
    try {
      await api("logout", {});
      setMachines(null);
      setCode(null);
    } catch {
      setError("Could not sign out. Please try again.");
    }
  }

  const visibleMachines = (machines ?? []).filter(
    (machine) =>
      machine.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (filter === "all" ||
        (!stale && !machine.revokedAt && machine.online
          ? "online"
          : "offline") === filter),
  );
  const onlineCount = (machines ?? []).filter(
    (machine) => !machine.revokedAt && machine.online,
  ).length;

  return (
    <main
      className={
        workspaceOpen
          ? `app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`
          : "public-shell"
      }
    >
      {workspaceOpen ? (
        <>
          <nav className="workspace-nav" aria-label="Workspace">
            <div className="workspace-nav-brand">
              <Brand />
            </div>
            <p className="workspace-nav-label">WORKSPACE</p>
            {workspaceItems.map((item, index) => (
              <a
                key={item.page}
                className={
                  index === 4
                    ? "workspace-nav-link tools-first"
                    : "workspace-nav-link"
                }
                href={`#${item.page}`}
                aria-current={page === item.page ? "page" : undefined}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <WorkspaceIcon name={item.page} />
                <span>{item.label}</span>
              </a>
            ))}
            <button
              className="workspace-signout"
              title={sidebarCollapsed ? "Sign out" : undefined}
              onClick={() => void logout()}
            >
              <WorkspaceIcon name="signout" />
              <span>Sign out</span>
            </button>
          </nav>
          <header className="workspace-topbar">
            <button
              className="workspace-menu-toggle"
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <WorkspaceIcon name="panel" />
            </button>
            <span className="workspace-mobile-brand">
              <Brand />
            </span>
            <span className="workspace-breadcrumb">
              REMOTE <span>/</span>{" "}
              <strong>
                {workspaceItems.find((item) => item.page === page)?.label}
              </strong>
            </span>
            <div className="header-end">
              <label className="theme-label">
                <span>Appearance</span>
                <select
                  aria-label="Appearance"
                  value={theme}
                  onChange={(event) => setTheme(event.target.value)}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </div>
          </header>
        </>
      ) : (
        <header>
          <Brand />
          <nav
            id="public-nav"
            className={publicMenuOpen ? "public-nav open" : "public-nav"}
            aria-label="Public navigation"
            onClick={() => setPublicMenuOpen(false)}
          >
            <a href="#home">Overview</a>
            <a href="#downloads">Download</a>
            <a href="#support">Support</a>
            <a href="#security">Security</a>
          </nav>
          <div className="header-end">
            <label className="theme-label public-theme">
              <span>Appearance</span>
              <select
                aria-label="Appearance"
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <a
              className="button secondary"
              href={signedIn ? "#computers" : "#signin"}
              aria-label={signedIn ? "Open workspace" : "Sign in"}
            >
              <span className="header-workspace-label">
                {signedIn ? "Workspace" : "Sign in"}
              </span>
              <span className="header-workspace-arrow" aria-hidden="true">
                →
              </span>
            </a>
            {page === "home" && !signedIn && (
              <a className="button header-workspace" href="#signin">
                Open workspace <span aria-hidden="true">→</span>
              </a>
            )}
            <button
              className="public-menu-toggle secondary"
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
                    publicMenuOpen
                      ? "M5 5l14 14M19 5L5 19"
                      : "M4 7h16M4 12h16M4 17h16"
                  }
                />
              </svg>
            </button>
          </div>
        </header>
      )}
      {!invite &&
      page !== "signin" &&
      !(
        ["computers", "sessions", "assist", "activity", "settings"].includes(
          page,
        ) && !signedIn
      ) &&
      page !== "computers" ? (
        page === "sessions" ? (
          <SessionHistory />
        ) : page === "settings" || page === "activity" ? (
          <AccountPanels activity={page === "activity"} />
        ) : (
          <ProductPage page={page} signedIn={signedIn} />
        )
      ) : machines === null || invite ? (
        <section className="login">
          <div className="login-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <h1>{invite ? "Create your account" : "Sign in"}</h1>
          <p>
            {invite
              ? "Choose a password with at least 16 characters. Your invitation expires after 30 minutes."
              : "Continue to your Beacon Remote workspace."}
          </p>
          <form onSubmit={signIn}>
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
                autoComplete={invite ? "new-password" : "current-password"}
                minLength={invite ? 16 : undefined}
                maxLength={512}
                required
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
            <button disabled={busy}>
              {invite ? "Create account" : "Continue"}
            </button>
          </form>
          <p className="note">
            Private alpha. Account creation requires an operator invitation.
            Password recovery and MFA are not available yet.
          </p>
        </section>
      ) : (
        <section>
          <div className="heading">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>Computers</h1>
              <p className="workspace-summary">
                {machines.length}{" "}
                {machines.length === 1 ? "computer" : "computers"}
                {!stale && <> · {onlineCount} online</>}
              </p>
            </div>
            <button onClick={pair} disabled={busy}>
              Add a computer
            </button>
          </div>
          {stale && (
            <p role="status">
              Connection interrupted. Status may be out of date.
            </p>
          )}
          {code && (
            <aside className="pairing-panel">
              <h2>Pair your Windows computer</h2>
              {clock < code.expiresAt ? (
                <>
                  <p>
                    Enter this one-use code in the Beacon Remote agent within
                    five minutes.
                  </p>
                  <div className="pairing-code-row">
                    <code aria-label="Pairing code">{code.code}</code>
                    <button
                      className="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(code.code);
                          setCodeCopied(true);
                        } catch {
                          setError(
                            "Could not copy the code. Select it manually.",
                          );
                        }
                      }}
                    >
                      {codeCopied ? "Copied" : "Copy code"}
                    </button>
                  </div>
                  <p className="note" role="status">
                    Expires in {Math.ceil((code.expiresAt - clock) / 1000)}{" "}
                    seconds
                  </p>
                </>
              ) : (
                <p>
                  This pairing code has expired. Choose Add a computer for a new
                  code.
                </p>
              )}
              <button className="secondary" onClick={() => setCode(null)}>
                Dismiss
              </button>
            </aside>
          )}
          <div
            className={
              selected ? "inventory-layout with-inspector" : "inventory-layout"
            }
          >
            <div className="grid">
              <div className="inventory-tools">
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
                <select
                  aria-label="Computer status"
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setSelected(null);
                  }}
                >
                  <option value="all">All computers</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              {machines.length === 0 && (
                <div className="inventory-empty">
                  <Monitor />
                  <h2>No computers yet</h2>
                  <p>
                    Pair a Windows computer to see its connection status here.
                  </p>
                </div>
              )}
              {machines.length > 0 && visibleMachines.length === 0 && (
                <div className="inventory-empty">
                  <h2>No matching computers</h2>
                  <p>Try a different search or status filter.</p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
              {visibleMachines.map((machine) => (
                <article key={machine.id} className="device-row">
                  <Monitor />
                  <button
                    id={`device-${machine.id}`}
                    className="device-name secondary"
                    onClick={() =>
                      setSelected(selected === machine.id ? null : machine.id)
                    }
                    aria-expanded={selected === machine.id}
                  >
                    {machine.name}
                  </button>
                  <p
                    className={machine.online && !stale ? "online" : "offline"}
                  >
                    {machine.revokedAt
                      ? "Access revoked"
                      : stale
                        ? "Status unavailable"
                        : machine.online
                          ? "● Online"
                          : "○ Offline"}
                  </p>
                  <button
                    disabled={
                      !mediaEnabled ||
                      busy ||
                      !machine.online ||
                      stale ||
                      view !== null ||
                      Boolean(machine.revokedAt)
                    }
                    onClick={() => {
                      void testVideo(machine);
                    }}
                    title="View only; requires approval on your Windows computer"
                  >
                    {mediaEnabled ? "View desktop" : "Remote — coming next"}
                  </button>
                </article>
              ))}
            </div>
            {selected &&
              machines.find((machine) => machine.id === selected) && (
                <ComputerInspector
                  key={selected}
                  stale={stale}
                  machine={machines.find((machine) => machine.id === selected)!}
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
          {view && (
            <LiveView
              grant={view.grant}
              name={view.name}
              onClose={() => setView(null)}
            />
          )}
        </section>
      )}
      {workspaceOpen && (
        <>
          <nav
            id="workspace-more"
            className="workspace-more"
            aria-label="More workspace pages"
            hidden={!mobileMore}
          >
            {workspaceItems.slice(4).map((item) => (
              <a
                key={item.page}
                href={`#${item.page}`}
                aria-current={page === item.page ? "page" : undefined}
              >
                <WorkspaceIcon name={item.page} />
                <span>{item.label}</span>
              </a>
            ))}
            <button onClick={() => void logout()}>
              <WorkspaceIcon name="signout" />
              <span>Sign out</span>
            </button>
          </nav>
          <nav
            className="workspace-mobile-nav"
            aria-label="Mobile workspace navigation"
          >
            {workspaceItems.slice(0, 4).map((item) => (
              <a
                key={item.page}
                href={`#${item.page}`}
                aria-current={page === item.page ? "page" : undefined}
              >
                <WorkspaceIcon name={item.page} />
                <span>{item.label}</span>
              </a>
            ))}
            <button
              aria-expanded={mobileMore}
              aria-current={
                page === "downloads" || page === "settings" ? "page" : undefined
              }
              aria-controls="workspace-more"
              onClick={() => setMobileMore(!mobileMore)}
            >
              <WorkspaceIcon name="more" />
              <span>More</span>
            </button>
          </nav>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer>Visible access. Explicit control. Beacon Remote.</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
