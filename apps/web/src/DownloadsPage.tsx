import { useState, type ReactNode } from "react";
import { useReleaseStatus } from "./release.js";

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

function Hash({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="verify-row">
      <dt>{label}</dt>
      <dd>
        <code className="download-hash" title={value}>
          {value.slice(0, 10)}…{value.slice(-8)}
        </code>
        <button
          type="button"
          className="secondary"
          aria-label={`Copy ${label} fingerprint`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              })
              .catch(() => undefined);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </dd>
    </div>
  );
}

function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="dl-steps">
      {children.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ol>
  );
}

export function DownloadsPage({ workspace }: { workspace: string }) {
  const { release, failed, retry } = useReleaseStatus();
  const windows = release?.installer ?? release;
  const android = release?.android;
  const pending = release === undefined;
  return (
    <section className="public-section downloads-page">
      <div className="downloads-heading">
        <div>
          <h1>Downloads</h1>
          <p>Install on the device you want to reach.</p>
        </div>
        <a className="button secondary" href={workspace}>
          Open workspace
        </a>
      </div>
      {failed && (
        <p className="error" role="alert">
          Couldn’t load downloads.{" "}
          <button className="secondary" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      <div className="download-platforms" aria-busy={pending}>
        <article className="download-platform">
          <svg
            className="download-platform-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8m-4-4v4" />
          </svg>
          <h2>Windows</h2>
          <p className="download-platform-meta">
            x64{windows && <> · {mb(windows.bytes)}</>}
          </p>
          {windows ? (
            <a className="button" href={`/downloads/${windows.file}`} download>
              Download for Windows
            </a>
          ) : (
            <button disabled>{pending ? "Checking…" : "Unavailable"}</button>
          )}
          {release && windows && (
            <>
              <Steps>
                {[
                  release.installer
                    ? "Run the installer."
                    : "Extract the ZIP and run Install.ps1.",
                  "Add a computer in your workspace.",
                  "Enter the pairing code in the host.",
                ]}
              </Steps>
              <h3 className="verify-title">Verify</h3>
              <dl className="verify">
                <Hash label="Installer" value={windows.sha256} />
                {release.installer && (
                  <Hash label="ZIP" value={release.sha256} />
                )}
                {release.signing && (
                  <>
                    <Hash label="Publisher" value={release.signing.sha256} />
                    <Hash
                      label="Trust script"
                      value={release.signing.scriptSha256}
                    />
                  </>
                )}
              </dl>
              <p className="verify-links">
                {release.installer && (
                  <a href={`/downloads/${release.file}`} download>
                    ZIP package
                  </a>
                )}
                {release.signing && (
                  <>
                    <a
                      href={`/downloads/${release.signing.certificate}`}
                      download
                    >
                      Certificate
                    </a>
                    <a href={`/downloads/${release.signing.script}`} download>
                      Trust script
                    </a>
                    <span>
                      Expires{" "}
                      <time dateTime={release.signing.notAfter}>
                        {new Date(release.signing.notAfter)
                          .toISOString()
                          .slice(0, 10)}
                      </time>
                    </span>
                  </>
                )}
              </p>
              {release.signing && (
                <p className="download-trust">
                  Private certificate. Match the fingerprint before you trust
                  it. The trust script needs admin approval; run it with{" "}
                  <code>-Remove</code> to undo.
                </p>
              )}
            </>
          )}
        </article>
        <article className="download-platform">
          <svg
            className="download-platform-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="6" y="2" width="12" height="20" rx="2" />
            <path d="M10 18h4" />
          </svg>
          <h2>Android</h2>
          <p className="download-platform-meta">
            Android 8+{android && <> · {mb(android.bytes)}</>}
          </p>
          {android ? (
            <a className="button" href={`/downloads/${android.file}`} download>
              Download for Android
            </a>
          ) : (
            <button disabled>{pending ? "Checking…" : "Unavailable"}</button>
          )}
          {android && (
            <>
              <Steps>
                {[
                  "Install the APK.",
                  "Allow only what you want to share.",
                  "Control needs accessibility access in Android Settings.",
                ]}
              </Steps>
              <h3 className="verify-title">Verify</h3>
              <dl className="verify">
                <Hash label="APK" value={android.sha256} />
                {android.signer && (
                  <Hash label="Signing key" value={android.signer} />
                )}
              </dl>
            </>
          )}
        </article>
      </div>
      <p className="downloads-release" role="status">
        {pending ? (
          "Checking for the current release…"
        ) : release ? (
          <>
            {release.version} ·{" "}
            <time dateTime={release.publishedAt}>
              {new Date(release.publishedAt).toISOString().slice(0, 10)}
            </time>
          </>
        ) : failed ? (
          "Downloads are temporarily unavailable."
        ) : (
          "No release is published right now."
        )}
      </p>
    </section>
  );
}
