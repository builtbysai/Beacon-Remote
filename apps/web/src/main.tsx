import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Machine } from "@beacon-remote/protocol";
import "./style.css";
import { LiveView, type ViewGrant } from "./LiveView.js";
import { Brand, Monitor, ProductPage, pageFromHash } from "./Product.js";
import { api, ApiError } from "./api.js";
import { AccountPanels } from "./AccountPanels.js";
import { SessionHistory } from "./SessionHistory.js";

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
  useEffect(() => {
    const change = () => setPage(pageFromHash());
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

  async function testVideo(machine: Machine, source: "synthetic" | "desktop") {
    setBusy(true);
    setError("");
    try {
      const grant = await api<ViewGrant>(`machines/${machine.id}/sessions`, {
        source,
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
      setCode({
        code: result.code,
        expiresAt: Date.now() + result.expiresInSeconds * 1000,
      });
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

  return (
    <main
      className={
        signedIn && page !== "home" && page !== "support" && page !== "security"
          ? "app-shell"
          : "public-shell"
      }
    >
      <header>
        <Brand />
        <nav aria-label="Public navigation">
          <a href="#home">Overview</a>
          <a href="#downloads">Download</a>
          <a href="#support">Support</a>
          <a href="#security">Security</a>
        </nav>
        <div className="header-end">
          <label className="theme-label">
            Appearance
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
          >
            {signedIn ? "Workspace" : "Sign in"}
          </a>
        </div>
      </header>
      {signedIn &&
        page !== "home" &&
        page !== "support" &&
        page !== "security" && (
          <nav className="workspace-nav" aria-label="Workspace">
            <p className="eyebrow">WORKSPACE</p>
            {[
              "computers",
              "sessions",
              "assist",
              "activity",
              "downloads",
              "settings",
            ].map((item) => (
              <a
                key={item}
                href={`#${item}`}
                aria-current={page === item ? "page" : undefined}
              >
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </a>
            ))}
            <button
              className="secondary"
              onClick={() => {
                void logout();
              }}
            >
              Sign out
            </button>
          </nav>
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
          <p className="eyebrow">YOUR COMPUTERS, WITHIN REACH</p>
          <h1>{invite ? "Create your account" : "Sign in"}</h1>
          <p>
            {invite
              ? "Choose a password with at least 16 characters. Your invitation expires after 30 minutes."
              : "Sign in to see your paired computers."}
          </p>
          <form onSubmit={signIn}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={invite ? "new-password" : "current-password"}
                minLength={invite ? 16 : undefined}
                maxLength={512}
                required
              />
            </label>
            <button
              type="button"
              className="secondary password-toggle"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide password" : "Show password"}
            </button>
            <button disabled={busy}>
              {invite ? "Create account" : "Sign in"}
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
            <aside>
              <h2>Pair your Windows computer</h2>
              {clock < code.expiresAt ? (
                <>
                  <p>
                    Enter this one-use code in the Beacon Remote agent within
                    five minutes.
                  </p>
                  <code>{code.code}</code>
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
          {machines.length === 0 && (
            <div className="empty">
              <h2>A home for your computers.</h2>
              <p>
                Add your first Windows computer to see its connection status
                here.
              </p>
            </div>
          )}
          <div className="grid">
            <div className="inventory-tools">
              <input
                type="search"
                aria-label="Search computers"
                placeholder="Search computers"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                aria-label="Computer status"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">All computers</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
            </div>
            {machines
              .filter(
                (machine) =>
                  machine.name.toLowerCase().includes(search.toLowerCase()) &&
                  (filter === "all" ||
                    (!stale && !machine.revokedAt && machine.online
                      ? "online"
                      : "offline") === filter),
              )
              .map((machine) => (
                <article key={machine.id} className="device-row">
                  <Monitor />
                  <button
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
                      void testVideo(machine, "desktop");
                    }}
                    title="View only; requires approval on your Windows computer"
                  >
                    {mediaEnabled ? "View desktop" : "Remote — coming next"}
                  </button>
                  {mediaEnabled && !machine.revokedAt && (
                    <button
                      disabled={
                        busy || !machine.online || stale || view !== null
                      }
                      onClick={() => {
                        void testVideo(machine, "synthetic");
                      }}
                    >
                      Test video connection
                    </button>
                  )}
                  {!machine.revokedAt && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        void revoke(machine.id);
                      }}
                    >
                      Revoke access
                    </button>
                  )}
                  {selected === machine.id && (
                    <div className="device-inspector">
                      <h3>Computer details</h3>
                      <dl>
                        <dt>Machine ID</dt>
                        <dd>{machine.id}</dd>
                        <dt>Last seen</dt>
                        <dd>
                          {machine.lastSeenAt
                            ? new Date(machine.lastSeenAt).toLocaleString()
                            : "Not reported"}
                        </dd>
                        <dt>Access</dt>
                        <dd>Attended · View only</dd>
                      </dl>
                    </div>
                  )}
                </article>
              ))}
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
