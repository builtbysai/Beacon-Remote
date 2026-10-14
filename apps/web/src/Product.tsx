import { GuestSupport } from "./GuestSupport.js";
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
            Email password recovery, a signed installer and the full
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

export type Release = {
  version: string;
  commit: string;
  file: string;
  bytes: number;
  sha256: string;
  publishedAt: string;
  // The double-click installer, when one was published with this build.
  installer?: { file: string; bytes: number; sha256: string };
  // Beacon Remote's own signing certificate and the script that trusts it on another computer (ADR 0035).
  signing?: {
    certificate: string;
    sha256: string;
    script: string;
    scriptSha256: string;
    notAfter: string;
  };
};

function groupedFingerprint(hex: string): string {
  return (hex.toUpperCase().match(/.{1,4}/g) ?? []).join(" ");
}

// The published build is described by /downloads/manifest.json, written when a build is published.
// A missing or malformed manifest means nothing is published.
export function useRelease(): Release | null | undefined {
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
        const installer = body?.installer;
        const installerOk =
          installer &&
          typeof installer.file === "string" &&
          /^BeaconRemoteSetup-[a-f0-9]{8,40}\.exe$/.test(installer.file) &&
          typeof installer.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(installer.sha256) &&
          typeof installer.bytes === "number";
        const signing = body?.signing;
        const signingOk =
          signing &&
          signing.certificate === "beacon-remote-signing.cer" &&
          signing.script === "Trust-BeaconRemote.ps1" &&
          typeof signing.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(signing.sha256) &&
          typeof signing.scriptSha256 === "string" &&
          /^[a-f0-9]{64}$/.test(signing.scriptSha256) &&
          typeof signing.notAfter === "string";
        if (live)
          setRelease(
            ok
              ? ({
                  ...body,
                  installer: installerOk ? installer : undefined,
                  signing: signingOk ? signing : undefined,
                } as Release)
              : null,
          );
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
  const installer = release?.installer;
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
                {((installer?.bytes ?? release.bytes) / 1_048_576).toFixed(1)}{" "}
                MB
              </p>
              <p>
                Installs for your Windows account only, with no administrator
                rights, and updates itself.{" "}
                {release.signing
                  ? "It is signed with Beacon Remote's own free certificate, not one from a public authority, so Windows warns about an unknown publisher until a computer has been told to trust it. The installer offers that once; the steps below do it on other computers."
                  : "This build is not signed, so Windows may warn before it opens; choose More info, then Run anyway, and check the SHA-256 below matches."}
              </p>
              <a
                className="button"
                href={`/downloads/${installer?.file ?? release.file}`}
                download
              >
                {installer ? "Download installer" : "Download for Windows"}
              </a>
              <p className="note">
                SHA-256{" "}
                <code className="hash">
                  {installer?.sha256 ?? release.sha256}
                </code>
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
      {release?.signing && (
        <>
          <h2>Trust the certificate on another computer</h2>
          <p>
            Check that the fingerprint matches before you trust it. The
            installer shows the same one, and the script refuses anything else.
          </p>
          <p className="note">
            Certificate SHA-256{" "}
            <code className="hash">
              {groupedFingerprint(release.signing.sha256)}
            </code>
            <br />
            Valid until {release.signing.notAfter.slice(0, 10)}
          </p>
          <ol>
            <li>
              Download{" "}
              <a href={`/downloads/${release.signing.script}`} download>
                Trust-BeaconRemote.ps1
              </a>{" "}
              (SHA-256 <code>{release.signing.scriptSha256}</code>).
            </li>
            <li>
              In PowerShell run{" "}
              <code>
                .\Trust-BeaconRemote.ps1 -Fingerprint{" "}
                {release.signing.sha256.toUpperCase()}
              </code>{" "}
              and approve the administrator prompt. Computers that already trust
              it are skipped.
            </li>
            <li>
              To undo it run <code>.\Trust-BeaconRemote.ps1 -Remove</code>. For
              many computers, import{" "}
              <a href={`/downloads/${release.signing.certificate}`} download>
                the certificate
              </a>{" "}
              with Group Policy.
            </li>
          </ol>
        </>
      )}
      <h2>Set up a computer</h2>
      <ol>
        <li>
          {installer
            ? "Open the installer. It adds Beacon Remote to the Start menu and starts it when you sign in."
            : "Extract the download, then run Install.ps1 with PowerShell. It installs for your user only."}
        </li>
        <li>
          In your workspace choose Add a computer, then enter the server
          address, a name and the one-use code in the Beacon Remote window
          within five minutes.
        </li>
        <li>
          In the Beacon Remote window decide whether your own account may
          connect without asking. Nothing is shared until you allow it, and you
          can stop or pause at any time.
        </li>
        <li>
          To remove it, use Apps and features in Windows settings. That also
          deletes the sign-in saved on the computer.
        </li>
      </ol>
      <a className="button" href={workspace}>
        Open workspace →
      </a>
    </section>
  );
}
