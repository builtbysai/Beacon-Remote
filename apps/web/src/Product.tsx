import { GuestSupport } from "./GuestSupport.js";
import { DownloadsPage } from "./DownloadsPage.js";
export { useRelease } from "./release.js";

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
  const raw = window.location.hash.slice(1);
  // Sign-up and password-reset are views of the sign-in card.
  const page = raw === "signup" || raw === "forgot" ? "signin" : raw;
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
                control protect access. Guest support requires the person at the
                computer to approve each connection.
              </p>
            </div>
          </div>
          <div className="setup-callout">
            <div>
              <h3>Set up your first computer</h3>
              <p>
                Install the Windows or Android host and pair it with your
                account.
              </p>
            </div>
            <a className="button" href="#downloads">
              Downloads →
            </a>
          </div>
        </section>
      </>
    );
  if (page === "downloads") return <DownloadsPage workspace={workspace} />;
  if (page === "support" || page === "assist")
    return (
      <section className="public-section">
        <p className="eyebrow">SUPPORT</p>
        <h1>Help, with permission.</h1>
        <div className="support-columns">
          <div>
            <h2>Getting help</h2>
            <p>
              If a technician sent you a link, just open it: it explains what to
              download and run, and everything is removed when support ends.
              Otherwise:
            </p>
            <ol className="help-steps">
              <li>
                Open Beacon Remote on your Windows computer and choose Support
                code.
              </li>
              <li>
                Read the code to the person helping you. It works once and
                expires in 15 minutes.
              </li>
              <li>
                Choose Allow when they connect. You can pause or stop at any
                time, and nothing is shared until you allow it.
              </li>
            </ol>
          </div>
          <div>
            <h2>Helping someone</h2>
            <p>
              Enter the code they read out. You do not need an account; a
              temporary guest session is created that can only run this one
              support session.
            </p>
            <GuestSupport />
          </div>
        </div>
        <div className="quiet-panel">
          <h2>Already paired?</h2>
          <p>
            Open Computers to connect to your own computers, or Assist for
            computers shared with you.
          </p>
          <a className="button" href={workspace}>
            My computers →
          </a>
        </div>
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
              Devices require local approval or an explicitly enabled standing
              access policy. Sharing has a visible Stop control; losing
              authorization ends access.
            </p>
          </div>
          <div>
            <h2>Device identity</h2>
            <p>
              Pairing codes expire and work once. Device keys stay on the
              endpoint; Windows protects its identity with DPAPI.
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
          <h2>Release boundaries</h2>
          <p>
            Email confirmation and recovery are available when configured by the
            server operator. Build and signing details are listed on Downloads.
            Windows sign-in access and the full device/network acceptance matrix
            remain unreleased. WebRTC transport encryption does not establish
            end-to-end peer authentication against the signaling service.
          </p>
        </div>
      </section>
    );
  return null;
}

export function Monitor() {
  return (
    <svg className="monitor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-5v5" />
    </svg>
  );
}
