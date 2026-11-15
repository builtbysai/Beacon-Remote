import { useReleaseStatus } from "./release.js";

function Fingerprint({ children }: { children: string }) {
  return <code className="download-hash">{children}</code>;
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
          <p>Install Beacon Remote on the device you want to access.</p>
        </div>
        <a href={workspace}>Open workspace →</a>
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
            Windows x64
            {windows && <> · {(windows.bytes / 1_048_576).toFixed(1)} MB</>}
          </p>
          {windows ? (
            <a className="button" href={`/downloads/${windows.file}`} download>
              Download for Windows
            </a>
          ) : (
            <button disabled>{pending ? "Checking…" : "Unavailable"}</button>
          )}
          {release && (
            <p className="download-trust">
              {release.signing
                ? "Private signing certificate. Verify the publisher before installing."
                : "No signing information is published for this build."}
            </p>
          )}
          {release && windows && (
            <details>
              <summary>Setup & verification</summary>
              <ol>
                <li>
                  {release.installer
                    ? "Open the installer. It installs for your Windows account."
                    : "Extract the ZIP and run Install.ps1 with PowerShell."}
                </li>
                <li>
                  Choose Add a computer in your workspace, then enter the
                  one-use pairing code in the host.
                </li>
                <li>
                  Choose who can connect in the host. Stop sharing remains
                  available locally.
                </li>
              </ol>
              <p>
                SHA-256<Fingerprint>{windows.sha256}</Fingerprint>
              </p>
              {release.installer && (
                <p>
                  <a href={`/downloads/${release.file}`} download>
                    ZIP package
                  </a>{" "}
                  · {(release.bytes / 1_048_576).toFixed(1)} MB
                  <Fingerprint>{release.sha256}</Fingerprint>
                </p>
              )}
              {release.signing && (
                <>
                  <h3>Publisher certificate</h3>
                  <p>
                    This build uses Beacon Remote’s private certificate. Compare
                    its fingerprint with a trusted source before deciding to
                    trust it.
                  </p>
                  <Fingerprint>{release.signing.sha256}</Fingerprint>
                  <p>
                    Certificate expires{" "}
                    <time dateTime={release.signing.notAfter}>
                      {new Date(release.signing.notAfter)
                        .toISOString()
                        .slice(0, 10)}
                    </time>
                    .
                  </p>
                  <p>
                    <a
                      href={`/downloads/${release.signing.certificate}`}
                      download
                    >
                      Certificate
                    </a>{" "}
                    ·{" "}
                    <a href={`/downloads/${release.signing.script}`} download>
                      Trust script
                    </a>
                  </p>
                  <p>
                    Trust script SHA-256
                    <Fingerprint>{release.signing.scriptSha256}</Fingerprint>
                  </p>
                  <p>
                    The script requires administrator approval and the matching
                    fingerprint. Use <code>-Remove</code> to remove that trust.
                  </p>
                </>
              )}
              <p>
                Remove the host through Windows Installed apps. Sign-in access
                has separate administrator setup and removal in the host.
              </p>
            </details>
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
            Android 8+ · APK
            {android && <> · {(android.bytes / 1_048_576).toFixed(1)} MB</>}
          </p>
          {android ? (
            <a className="button" href={`/downloads/${android.file}`} download>
              Download for Android
            </a>
          ) : (
            <button disabled>{pending ? "Checking…" : "Unavailable"}</button>
          )}
          {android && (
            <details>
              <summary>Setup & verification</summary>
              <p>
                Install the APK from this browser. Enable only the permissions
                you want to use in Beacon Remote; control requires a separate
                accessibility permission in Android Settings.
              </p>
              <p>
                SHA-256<Fingerprint>{android.sha256}</Fingerprint>
              </p>
              {android.signer && (
                <p>
                  Signing key SHA-256<Fingerprint>{android.signer}</Fingerprint>
                </p>
              )}
            </details>
          )}
        </article>
      </div>
      <p className="downloads-release" role="status">
        {pending ? (
          "Checking for the current release…"
        ) : release ? (
          <>
            {release.version} · Published{" "}
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
