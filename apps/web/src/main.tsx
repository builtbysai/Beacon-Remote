import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Machine } from "@beacon-remote/protocol";
import "./style.css";

// Fragments stay out of HTTP/access logs; remove the bearer from browser history.
const invitation = new URLSearchParams(window.location.hash.slice(1)).get(
  "invite",
);
if (invitation) window.history.replaceState(null, "", window.location.pathname);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Please sign in.");
    throw new Error("Request failed. Please try again.");
  }
  return response.json() as Promise<T>;
}

function App() {
  const [invite, setInvite] = useState(invitation);
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [clock, setClock] = useState(Date.now());

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
    } catch {
      setError(
        invite
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
    <main>
      <header>
        <a className="brand" href="/">
          ◉ Beacon <span>Remote</span>
        </a>
        <small>PRIVATE DEVELOPMENT</small>
      </header>
      {machines === null ? (
        <section className="login">
          <p className="eyebrow">YOUR COMPUTERS, WITHIN REACH</p>
          <h1>{invite ? "Create your account." : "Welcome back."}</h1>
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
                type="password"
                autoComplete={invite ? "new-password" : "current-password"}
                minLength={invite ? 16 : undefined}
                maxLength={512}
                required
              />
            </label>
            <button disabled={busy}>
              {invite ? "Create account" : "Sign in"}
            </button>
          </form>
          <p className="note">
            This development release supports pairing and presence. Desktop
            viewing and control are being built.
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
            {machines.map((machine) => (
              <article key={machine.id}>
                <div className="computer-icon">▣</div>
                <h2>{machine.name}</h2>
                <p className={machine.online && !stale ? "online" : "offline"}>
                  {machine.revokedAt
                    ? "Access revoked"
                    : stale
                      ? "Status unavailable"
                      : machine.online
                        ? "● Online"
                        : "○ Offline"}
                </p>
                <button
                  disabled
                  title="Desktop streaming is not available in this development release"
                >
                  Remote — coming next
                </button>
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
              </article>
            ))}
          </div>
          <button
            className="secondary"
            onClick={() => {
              void logout();
            }}
          >
            Sign out
          </button>
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
