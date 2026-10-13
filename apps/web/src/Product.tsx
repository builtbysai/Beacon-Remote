import { useEffect, useState } from "react";

export type Page =
  | "home"
  | "signin"
  | "computers"
  | "downloads"
  | "support"
  | "security"
  | "sessions"
  | "assist"
  | "activity"
  | "settings";

export function pageFromHash(): Page {
  const page = window.location.hash.slice(1);
  return [
    "signin",
    "computers",
    "downloads",
    "support",
    "security",
    "sessions",
    "assist",
    "activity",
    "settings",
  ].includes(page)
    ? (page as Page)
    : "home";
}

export function Brand() {
  return (
    <a className="brand" href="#home" aria-label="Beacon Remote home">
      <img src="/beacon-mark.svg" alt="" />
      <span>
        beacon<small>REMOTE</small>
      </span>
    </a>
  );
}

export function ProductPage({
  page,
  signedIn,
}: {
  page: Page;
  signedIn: boolean;
}) {
  const workspace = signedIn ? "#computers" : "#signin";
  if (page === "home")
    return (
      <>
        <section className="hero">
          <div>
            <p className="eyebrow">BEACON / REMOTE</p>
            <h1>Remote access for your computers.</h1>
            <p>
              Connect to an enrolled Windows computer from your browser. Approve
              each connection on the computer, or turn on trusted access there
              once for your own account.
            </p>
            <div className="actions">
              <a className="button" href={workspace}>
                Open my computers →
              </a>
              <a className="button secondary" href="#downloads">
                Download for Windows
              </a>
            </div>
            <p className="note">Private alpha · Windows computers</p>
          </div>
          <div
            className="product-preview"
            aria-label="Illustration of the computer workspace; example data, not connected"
          >
            <div className="preview-bar">
              <span className="preview-dots" aria-hidden="true">
                ● ● ●
              </span>
              <span>remote.builtbysai.com</span>
            </div>
            <div className="preview-layout">
              <div className="preview-sidebar" aria-hidden="true">
                <strong>▣&nbsp; Computers</strong>
                <span>◷&nbsp; Sessions</span>
                <span>♧&nbsp; Assist</span>
                <span>◇&nbsp; Activity</span>
              </div>
              <div className="preview-content">
                <div className="preview-heading">
                  <strong>Computers</strong>
                  <span>6 online</span>
                </div>
                {[
                  "STUDIO-WS",
                  "ZBOOK-15",
                  "HOME-PC",
                  "FRONTDESK-02",
                  "LAB-NODE-03",
                ].map((name, index) => (
                  <div
                    className={`preview-device${index === 0 ? " selected" : ""}`}
                    key={name}
                  >
                    <Monitor />
                    <strong>{name}</strong>
                    <span>{index === 4 ? "Offline" : "Online"}</span>
                    {index === 0 && <b>Remote</b>}
                  </div>
                ))}
                <p>EXAMPLE DATA · NOT CONNECTED</p>
              </div>
            </div>
          </div>
        </section>
        <div className="public-steps-band">
          <div className="steps">
            <p>
              <strong>01</strong> Install the Windows agent
            </p>
            <p>
              <strong>02</strong> Pair with your account
            </p>
            <p>
              <strong>03</strong> Connect from the browser
            </p>
          </div>
        </div>
        <section className="public-section access-section">
          <div className="access-heading">
            <h2>Access and support</h2>
            <a href="#support">Get support →</a>
          </div>
          <div className="feature-columns access-features">
            <div>
              <Monitor />
              <h3>Your computers</h3>
              <p>
                Enrolled computers appear in your workspace. See connection
                status and revoke access when needed.
              </p>
            </div>
            <div>
              <span className="access-feature-icon" aria-hidden="true">
                ◎
              </span>
              <h3>You choose how a computer is reached</h3>
              <p>
                Approve each request on the computer, or set it to trusted
                access there. Sharing is always visible, and the person at the
                computer can stop it at any time.
              </p>
            </div>
            <div>
              <span className="access-feature-icon" aria-hidden="true">
                ◇
              </span>
              <h3>Connection controls</h3>
              <p>
                Device identity, revocation, session history and a visible Stop
                control protect access. Guest support is still being built.
              </p>
            </div>
          </div>
          <div className="setup-callout">
            <div>
              <h3>Set up your first computer</h3>
              <p>Windows development agent and account pairing.</p>
            </div>
            <a className="button" href="#downloads">
              Windows setup →
            </a>
          </div>
        </section>
      </>
    );
  if (page === "downloads") return <DownloadsPage workspace={workspace} />;
  if (page === "support" || page === "assist")
    return (
      <section className="public-section">
        <p className="eyebrow">ATTENDED SUPPORT</p>
        <h1>Help, with permission.</h1>
        <p>
          Accountless support codes and control approval are not available in
          this alpha.
        </p>
        <div className="quiet-panel">
          <h2>Already paired?</h2>
          <p>
            Open Computers to request view-only access. The person at the
            Windows computer must approve sharing and can stop it locally.
          </p>
          <a className="button" href={workspace}>
            My computers →
          </a>
        </div>
        <button disabled>Start guest support — unavailable</button>
      </section>
    );
  if (page === "security")
    return (
      <section className="public-section">
        <p className="eyebrow">SECURITY</p>
        <h1>Visible access. Explicit control.</h1>
        <div className="feature-columns">
          <div>
            <h2>Local approval</h2>
            <p>
              Desktop viewing requires approval on Windows. Sharing has a
              visible Stop control. Access ends when stopped or authorization is
              lost.
            </p>
          </div>
          <div>
            <h2>Device identity</h2>
            <p>
              Pairing codes expire and work once. Machine keys stay on the
              endpoint, protected with Windows user-scoped DPAPI.
            </p>
          </div>
          <div>
            <h2>Access boundaries</h2>
            <p>
              Secure browser sessions and account isolation protect your
              inventory. Viewing grants do not authorize keyboard or mouse
              input.
            </p>
          </div>
        </div>
        <div className="quiet-panel">
          <h2>Alpha limitations</h2>
          <p>
            MFA, password recovery, signed installation and the full
            cross-network recovery test matrix are unfinished. WebRTC uses
            transport encryption; this alpha does not claim end-to-end peer
            authentication against the signaling service.
          </p>
        </div>
      </section>
    );
  if (page === "settings")
    return (
      <section className="public-section">
        <h1>Settings</h1>
        <h2>Account security</h2>
        <p>
          Browser sessions expire after eight hours. Sign out to end this
          browser’s session.
        </p>
        <div className="quiet-panel">
          <h3>Additional security controls</h3>
          <p>
            Authenticator MFA, recovery and a list of other browser sessions are
            not available yet.
          </p>
          <button disabled>Manage browser sessions</button>
        </div>
      </section>
    );
  return (
    <section className="public-section">
      <h1>{page === "sessions" ? "Sessions" : "Activity"}</h1>
      <div className="quiet-panel">
        <h2>
          {page === "sessions"
            ? "Session history is not available yet."
            : "Activity history is not available yet."}
        </h2>
        <p>
          The backend does not yet expose account history. Live connection state
          appears in the desktop viewer.
        </p>
        <a className="button secondary" href={workspace}>
          Back to computers
        </a>
      </div>
    </section>
  );
}

export function Monitor() {
  return (
    <svg className="monitor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-5v5" />
    </svg>
  );
}

type Release = {
  version: string;
  commit: string;
  file: string;
  bytes: number;
  sha256: string;
  publishedAt: string;
};

// The published build is described by /downloads/manifest.json, written when a build is published.
// A missing or malformed manifest means nothing is published.
function useRelease(): Release | null | undefined {
  const [release, setRelease] = useState<Release | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch("/downloads/manifest.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const ok =
          body &&
          typeof body.file === "string" &&
          /^[A-Za-z0-9._-]+\.zip$/.test(body.file) &&
          typeof body.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(body.sha256) &&
          typeof body.version === "string" &&
          typeof body.bytes === "number";
        if (live) setRelease(ok ? (body as Release) : null);
      })
      .catch(() => live && setRelease(null));
    return () => {
      live = false;
    };
  }, []);
  return release;
}

function DownloadsPage({ workspace }: { workspace: string }) {
  const release = useRelease();
  return (
    <section className="public-section">
      <p className="eyebrow">SETUP</p>
      <h1>Download Beacon Remote</h1>
      <p>Windows host software connects your computer to the workspace.</p>
      <div className="download-panel">
        <Monitor />
        <div>
          <h2>Windows host</h2>
          {release ? (
            <>
              <p>
                Version {release.version} · Windows x64 ·{" "}
                {(release.bytes / 1_048_576).toFixed(1)} MB
              </p>
              <p>
                This is an unsigned build for your own computers. Windows may
                warn about it, and there are no automatic updates yet. Check the
                SHA-256 below matches the file you downloaded.
              </p>
              <a
                className="button"
                href={`/downloads/${release.file}`}
                download
              >
                Download for Windows
              </a>
              <p className="note">
                SHA-256 <code>{release.sha256}</code>
              </p>
            </>
          ) : (
            <>
              <p>Windows x64</p>
              <p>
                {release === undefined
                  ? "Checking for the current build…"
                  : "No build is published right now."}
              </p>
              <button disabled>Installer unavailable</button>
            </>
          )}
        </div>
      </div>
      <h2>Set up a computer</h2>
      <ol>
        <li>
          Extract the download, then run Install.ps1 with PowerShell. It
          installs for your user only and asks for no administrator rights.
        </li>
        <li>
          Open Beacon Remote Development from the Start menu, then choose Host.
        </li>
        <li>
          In your workspace choose Add a computer, and enter the server address,
          a name and the one-use code in the host window within five minutes.
        </li>
        <li>
          Choose Start host. In the host window you can turn on start at sign-in
          and decide whether your own account may connect without asking.
        </li>
      </ol>
      <a className="button" href={workspace}>
        Open workspace →
      </a>
    </section>
  );
}
