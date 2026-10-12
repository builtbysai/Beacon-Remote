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
              Connect to an enrolled Windows computer from your browser, with
              approval from the person at the computer.
            </p>
            <div className="actions">
              <a className="button" href={workspace}>
                Open my computers →
              </a>
              <a className="button secondary" href="#downloads">
                Download for Windows
              </a>
            </div>
            <p className="note">Private alpha · Attended, view-only access</p>
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
        <section className="public-section">
          <div className="steps">
            <p>
              <strong>01</strong> Install the Windows agent
            </p>
            <p>
              <strong>02</strong> Pair with your account
            </p>
            <p>
              <strong>03</strong> Approve and view
            </p>
          </div>
          <h2>Access and support</h2>
          <div className="feature-columns">
            <div>
              <h3>Your computers</h3>
              <p>
                Keep enrolled computers together. See connection status and
                revoke access from your workspace.
              </p>
            </div>
            <div>
              <h3>Visible access</h3>
              <p>
                Desktop viewing requires local approval and a visible Stop
                sharing control. Development sessions end after two minutes.
              </p>
            </div>
            <div>
              <h3>One-time support</h3>
              <p>
                Guest support is being built. This alpha currently supports
                enrolled computers only.
              </p>
              <a href="#support">Support availability →</a>
            </div>
          </div>
        </section>
      </>
    );
  if (page === "downloads")
    return (
      <section className="public-section">
        <p className="eyebrow">SETUP</p>
        <h1>Download Beacon Remote</h1>
        <p>Windows host software connects your computer to the workspace.</p>
        <div className="download-panel">
          <Monitor />
          <div>
            <h2>Windows agent</h2>
            <p>Development build · Windows x64</p>
            <p>
              A signed installer and automatic updates are not available yet. No
              production download is published.
            </p>
            <button disabled>Installer unavailable</button>
          </div>
        </div>
        <h2>Pair an existing development agent</h2>
        <ol>
          <li>Sign in and choose Add a computer.</li>
          <li>Run the agent’s pair command on your Windows computer.</li>
          <li>
            Enter the server address, computer name and one-use code within five
            minutes.
          </li>
        </ol>
        <a className="button" href={workspace}>
          Open workspace →
        </a>
      </section>
    );
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
              visible Stop control and a two-minute limit.
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
