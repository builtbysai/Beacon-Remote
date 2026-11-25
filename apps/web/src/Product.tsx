import { GuestSupport } from "./GuestSupport.js";
import { Badge, Character, Spark } from "./Characters.js";
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
      <svg
        className="brand-mark"
        viewBox="0 0 48 48"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="48" height="48" rx="13" fill="#2D6CF6" />
        <rect x="6" y="15" width="27" height="19" rx="5.5" fill="#fff" />
        <rect x="9" y="18" width="21" height="13" rx="3" fill="#2D6CF6" />
        <circle cx="15.5" cy="23.2" r="1.8" fill="#fff" />
        <circle cx="23.5" cy="23.2" r="1.8" fill="#fff" />
        <path
          d="M16 27 q4 3.2 8 0"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <rect x="17" y="34" width="6" height="3.5" fill="#fff" />
        <rect x="12" y="37" width="16" height="3.5" rx="1.75" fill="#fff" />
        <g className="brand-arcs" fill="none" stroke="#73E4CD">
          <circle cx="36.5" cy="12.5" r="2.5" fill="#73E4CD" stroke="none" />
          <path
            d="M36.5 6.5 a6 6 0 0 1 6 6"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <path
            d="M36.5 1.5 a11 11 0 0 1 11 11"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <span>
        Beacon <small>Remote</small>
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
          <div className="hero-art hero-art-left" aria-hidden="true">
            <Character tone="blue" mood="wave" className="hero-char big" />
            <Character tone="mint" mood="awake" className="hero-char small" />
            <Spark className="p1" />
            <Spark className="p2" />
            <Badge kind="lock" className="p3" />
          </div>
          <div className="hero-copy">
            <h1>
              Remote access that{" "}
              <span className="scribbled">
                knocks first.
                <svg viewBox="0 0 340 22" aria-hidden="true" focusable="false">
                  <path d="M3 14 C 52 4, 118 18, 176 9 S 292 12, 337 5" />
                </svg>
              </span>
            </h1>
            <p className="hero-lede">
              Open your Windows computers from any browser. The person at the
              keyboard says yes, sees everything, and can stop it at any time.
            </p>
            <div className="actions">
              <a className="button" href={workspace}>
                Open my computers
              </a>
              <a className="button soft" href="#downloads">
                Download for Windows
              </a>
            </div>
            <p className="fine">Android phones can be paired too.</p>
          </div>
          <div className="hero-art hero-art-right" aria-hidden="true">
            <Character tone="sun" mood="awake" className="hero-char big" />
            <Character tone="coral" mood="asleep" className="hero-char small" />
            <Badge kind="check" className="p3" />
            <Spark className="p1" />
            <Spark className="p2" />
          </div>
        </section>

        <section className="section reveal">
          <h2 className="section-title">You stay in charge.</h2>
          <div className="bento">
            <article className="tile tile-ask">
              <div className="tile-ui">
                <div className="shot-dialog" aria-hidden="true">
                  <div className="shot-dialog-title">
                    <img src="/beacon-mark.svg" alt="" />
                    Beacon Remote
                  </div>
                  <p className="shot-dialog-ask">
                    Allow a browser to view this computer?
                  </p>
                  <p>
                    It can see your screen. It cannot use your keyboard or mouse
                    unless you allow that as well.
                  </p>
                  <div className="shot-dialog-actions">
                    <span>Decline</span>
                    <span className="is-primary">Allow once</span>
                  </div>
                </div>
              </div>
              <h3>It asks first.</h3>
              <p>
                A computer asks before every connection. Trusted access, if you
                turn it on, applies to your own account only.
              </p>
            </article>
            <article className="tile tile-visible">
              <div className="tile-ui" aria-hidden="true">
                <div className="banner">
                  <span className="banner-dot" />
                  <span>A browser is viewing this computer</span>
                  <span className="banner-stop">Stop</span>
                </div>
              </div>
              <h3>You can always see it.</h3>
              <p>
                Sharing shows on the computer, with a Stop button that works at
                any time.
              </p>
            </article>
            <article className="tile tile-input">
              <div className="tile-ui" aria-hidden="true">
                <div className="segmented">
                  <span className="is-on">View only</span>
                  <span>Control</span>
                </div>
              </div>
              <h3>Viewing is not control.</h3>
              <p>
                Control is a separate request, and held keys are released when a
                session ends.
              </p>
            </article>
            <article className="tile tile-revoke">
              <div className="tile-ui" aria-hidden="true">
                <div className="mini-row">
                  <Character tone="coral" mood="locked" className="mini-char" />
                  <span>
                    <strong>LAB-NODE-03</strong>
                    <small>Access revoked</small>
                  </span>
                </div>
              </div>
              <h3>Revoke it and it stays out.</h3>
              <p>
                A revoked computer cannot connect again until you pair it again.
              </p>
            </article>
          </div>
        </section>

        <section className="section reveal">
          <h2 className="section-title">Set up in three steps.</h2>
          <ol className="path">
            <li>
              <Character tone="sun" mood="awake" className="path-char" />
              <h3>Install the Windows app</h3>
              <p>The installer sets it up for your Windows account.</p>
            </li>
            <li>
              <Character tone="mint" mood="wave" className="path-char" />
              <h3>Pair the computer</h3>
              <p>
                In Computers, choose Add a computer, then enter the one-use code
                in the app.
              </p>
            </li>
            <li>
              <Character tone="blue" mood="awake" className="path-char" />
              <h3>Connect</h3>
              <p>
                Pick a computer, then Remote or View only. Whoever is at the
                computer approves it, unless you turned on trusted access there.
              </p>
            </li>
          </ol>
        </section>

        <section className="cta-block reveal">
          <div className="cta-copy">
            <h2>Ready when your computers are.</h2>
            <a className="button light" href="#downloads">
              Download for Windows
            </a>
          </div>
          <div className="cta-art" aria-hidden="true">
            <Character tone="mint" mood="wave" className="cta-char" />
            <Character tone="sun" mood="awake" className="cta-char two" />
          </div>
        </section>
      </>
    );
  if (page === "downloads") return <DownloadsPage workspace={workspace} />;
  if (page === "support" || page === "assist")
    return (
      <section className="public-section">
        <div className="page-head">
          <h1>Support</h1>
          <Character tone="sun" mood="wave" className="page-char" />
        </div>
        <div className="support-columns">
          <div>
            <h2>Getting help</h2>
            <p>
              If a technician sent you a link, open it and follow the steps.
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
                time.
              </li>
            </ol>
          </div>
          <div>
            <h2>Helping someone</h2>
            <p>Enter the code they read to you. No account needed.</p>
            <GuestSupport />
          </div>
        </div>
      </section>
    );
  if (page === "security")
    return (
      <section className="public-section">
        <div className="page-head">
          <h1>Security</h1>
          <Character tone="blue" mood="awake" className="page-char" />
        </div>
        <p className="page-lede">Nothing connects unless you allow it.</p>
        <div className="security-grid">
          <article className="tile mint">
            <h2>Asks first</h2>
            <p>
              Every connection needs approval on the computer, unless you turn
              on trusted access.
            </p>
          </article>
          <article className="tile sun">
            <h2>Always stoppable</h2>
            <p>
              A Stop button stays on screen while you share. Losing
              authorization ends access.
            </p>
          </article>
          <article className="tile blue">
            <h2>Keys stay put</h2>
            <p>
              Pairing codes expire and work once. Device keys stay on the
              computer, protected by Windows DPAPI.
            </p>
          </article>
          <article className="tile coral">
            <h2>View means view</h2>
            <p>
              Watching never grants mouse or keyboard. Accounts are isolated
              from each other.
            </p>
          </article>
        </div>
        <section className="security-later">
          <h2>Not yet released</h2>
          <ul>
            <li>Windows sign-in screen access</li>
            <li>The full device and network acceptance matrix</li>
            <li>Peer authentication against the signaling service</li>
            <li>Email recovery depends on the operator’s server setup</li>
          </ul>
          <p>
            Build and signing details are on the{" "}
            <a href="#downloads">Downloads</a> page.
          </p>
        </section>
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
