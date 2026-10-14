import { useEffect, useState } from "react";
import { api } from "./api.js";
import { useRelease } from "./Product.js";

type Platform = "windows" | "android" | "linux" | "mac" | "ios";
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "windows", label: "Windows" },
  { id: "android", label: "Android" },
  { id: "linux", label: "Linux" },
  { id: "mac", label: "Mac" },
  { id: "ios", label: "iPhone or iPad" },
];

// A convenience only: the person can always pick another system, and nothing here is a security boundary.
export function detectPlatform(): Platform {
  const navigatorWithData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const hint = navigatorWithData.userAgentData?.platform?.toLowerCase() ?? "";
  const agent = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(agent)) return "ios";
  if (hint === "android" || agent.includes("android")) return "android";
  if (hint === "windows" || agent.includes("windows")) return "windows";
  if (hint === "macos" || agent.includes("macintosh")) return "mac";
  if (hint === "linux" || agent.includes("linux") || agent.includes("x11"))
    return "linux";
  return "windows";
}

type Invite = {
  technician: string;
  capability: "desktop:view" | "desktop:control";
  label?: string | null;
};

// What someone sees after clicking a technician's link: who is asking, and the one thing to download and run.
export function SupportInvite({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const release = useRelease();
  useEffect(() => {
    let live = true;
    api<Invite>("support-invite/preview", { token })
      .then((body) => live && setInvite(body))
      .catch(() => live && setInvite(null));
    return () => {
      live = false;
    };
  }, [token]);
  const installer = release?.installer;
  return (
    <section className="public-section support-invite">
      <p className="eyebrow">REMOTE SUPPORT</p>
      {invite === undefined ? (
        <h1>Checking your link…</h1>
      ) : invite === null ? (
        <>
          <h1>This support link can't be used</h1>
          <p>
            It has expired, was already used, or was cancelled. Ask your
            technician to send a new one. Nothing was installed or changed.
          </p>
        </>
      ) : (
        <>
          <h1>Someone wants to help you remotely</h1>
          <p>
            {invite.label ? `${invite.label}. ` : ""}
            <strong className="support-who">{invite.technician}</strong> wants
            to{" "}
            {invite.capability === "desktop:control"
              ? "see your screen and be able to control it"
              : "see your screen"}
            . Nothing is shared until you choose <strong>Allow</strong> on your
            own computer, and you can stop at any time.
          </p>
          <label className="support-platform">
            Your computer
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
            >
              {PLATFORMS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <div className="support-columns">
            {platform === "windows" ? (
              <div className="download-panel">
                <div>
                  <h2>Temporary support for Windows</h2>
                  {installer ? (
                    <>
                      <p>
                        A small program that runs only for this session. It
                        doesn't install anything permanent or start with
                        Windows, and removes itself when support ends.
                      </p>
                      <a
                        className="button"
                        href={`/downloads/${installer.file}`}
                        download={`BeaconSupport-${token}.exe`}
                      >
                        Download support program
                      </a>

                      <p className="note">
                        Windows x64 · {(installer.bytes / 1_048_576).toFixed(1)}{" "}
                        MB · SHA-256{" "}
                        <code className="hash">{installer.sha256}</code>
                        <br />
                        The file name carries your link, so keep it as it is.
                        This link works once and expires if unused.
                      </p>
                    </>
                  ) : (
                    <p>
                      {release === undefined
                        ? "Checking for the current build…"
                        : "The support program isn't available right now. Ask your technician to try again later."}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="download-panel">
                <div>
                  <h2>
                    One-click support isn't available for{" "}
                    {PLATFORMS.find((entry) => entry.id === platform)?.label}{" "}
                    yet
                  </h2>
                  <p>
                    Temporary support currently works on Windows. If this is the
                    wrong system, choose Windows above. Otherwise ask{" "}
                    {invite.technician} for another way to help.
                  </p>
                </div>
              </div>
            )}
            <div>
              <h2>What happens next</h2>
              <ol className="help-steps">
                <li>
                  Open the downloaded file. If Windows asks whether to run it,
                  choose Run (More info, then Run anyway, if it says the
                  publisher is unknown).
                </li>
                <li>Check who is asking, then choose Yes.</li>
                <li>
                  When {invite.technician} connects, choose Allow to let them
                  in. You can pause or stop at any time.
                </li>
                <li>
                  When support ends, the program and everything it created are
                  removed.
                </li>
              </ol>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
