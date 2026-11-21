import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.js";
import { qrModules } from "./qr.js";

type Progress = {
  state: "waiting" | "claimed" | "expired" | "cancelled" | "unavailable";
  machine: { id: string; name: string } | null;
};
type Invitation = { code: string; deadline: number };

// Opens the Android app with the code filled in; the person still taps Pair there.
/** The pairing link drawn as a QR code (an SVG of dark squares). A phone's camera opens it in the Beacon app. */
export function PairingQr({ link }: { link: string }) {
  const modules = qrModules(link);
  if (!modules) return null;
  const quiet = 4;
  const size = modules.length + quiet * 2;
  const path = modules
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : "")),
    )
    .join("");
  return (
    <svg
      className="pairing-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code for the phone pairing link"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#171a19" />
    </svg>
  );
}

export function pairingLink(origin: string, code: string) {
  return `beaconremote://pair?code=${encodeURIComponent(code)}&server=${encodeURIComponent(origin)}`;
}

export function PairComputer({
  onClose,
  onPaired,
}: {
  onClose: () => void;
  onPaired: (id: string | null) => void;
}) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [progress, setProgress] = useState<Progress>({
    state: "waiting",
    machine: null,
  });
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [creating, setCreating] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState<"code" | "address" | "link" | null>(
    null,
  );
  const [seconds, setSeconds] = useState(300);
  const [attempt, setAttempt] = useState(0);
  const owned = useRef<string | null>(null);
  const settled = useRef(false);
  const paired = useRef(onPaired);
  paired.current = onPaired;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    settled.current = false;
    setCreating(true);
    setError("");
    setStatusError("");
    setCopied(null);
    setInvitation(null);
    setProgress({ state: "waiting", machine: null });
    // Do not abort issuance and lose the returned bearer. If the panel closes
    // while issuance is pending, cancel only the code this request created.
    void api<{ code: string; expiresInSeconds: number }>(
      "enrollments",
      {},
      AbortSignal.timeout(10_000),
    )
      .then((result) => {
        if (!live) {
          void api(
            "enrollments/cancel",
            { code: result.code },
            AbortSignal.timeout(5000),
          ).catch(() => {});
          return;
        }
        owned.current = result.code;
        setInvitation({
          code: result.code,
          deadline: performance.now() + result.expiresInSeconds * 1000,
        });
        setSeconds(result.expiresInSeconds);
      })
      .catch(() => {
        if (live) setError("Couldn’t create a pairing code. Try again.");
      })
      .finally(() => {
        if (live) setCreating(false);
      });
    return () => {
      live = false;
      const code = owned.current;
      owned.current = null;
      if (code)
        void api(
          "enrollments/cancel",
          { code },
          AbortSignal.timeout(5000),
        ).catch(() => {});
    };
  }, [attempt]);

  useEffect(() => {
    if (!invitation || progress.state !== "waiting") return;
    const timer = window.setInterval(
      () =>
        setSeconds(
          Math.max(
            0,
            Math.ceil((invitation.deadline - performance.now()) / 1000),
          ),
        ),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [invitation, progress.state]);

  useEffect(() => {
    if (!invitation) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      if (controller.signal.aborted || settled.current) return;
      try {
        const result = await api<Progress>(
          "enrollments/status",
          { code: invitation!.code },
          AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        );
        if (controller.signal.aborted || settled.current) return;
        setProgress(result);
        setStatusError("");
        if (result.state !== "waiting") {
          setError("");
          settled.current = true;
          owned.current = null;
          if (result.state === "claimed")
            paired.current(result.machine?.id ?? null);
          return;
        }
      } catch (failure) {
        if (controller.signal.aborted || settled.current) return;
        if (failure instanceof ApiError && failure.status === 404) {
          settled.current = true;
          owned.current = null;
          setProgress({ state: "unavailable", machine: null });
          setStatusError("");
          return;
        }
        setStatusError(
          "Couldn’t check pairing. Retrying; the code still expires automatically.",
        );
      }
      timer = window.setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [invitation]);

  async function cancel() {
    if (!invitation || progress.state !== "waiting") {
      onClose();
      return;
    }
    setCancelling(true);
    setError("");
    try {
      const result = await api<Progress>(
        "enrollments/cancel",
        { code: invitation.code },
        AbortSignal.timeout(5000),
      );
      owned.current = null;
      settled.current = true;
      if (result.state === "claimed") {
        setProgress(result);
        paired.current(result.machine?.id ?? null);
      } else onClose();
    } catch {
      if (!settled.current)
        setError(
          "Couldn’t cancel the code. Try again; it remains valid until it expires.",
        );
    } finally {
      setCancelling(false);
    }
  }
  async function copy(value: string, kind: "code" | "address" | "link") {
    const code = owned.current;
    try {
      await navigator.clipboard.writeText(value);
      if (owned.current === code && !settled.current) {
        setCopied(kind);
        setError("");
      }
    } catch {
      if (owned.current === code && !settled.current)
        setError("Couldn’t copy. Select the address or code manually.");
    }
  }
  const waiting = progress.state === "waiting";
  return (
    <section
      className="pairing-panel"
      aria-labelledby="pairing-title"
      aria-busy={creating || cancelling}
    >
      <div className="pairing-heading">
        <h2 id="pairing-title" ref={heading} tabIndex={-1}>
          {progress.state === "claimed" ? "Computer paired" : "Add a computer"}
        </h2>
        <button
          className="secondary"
          disabled={cancelling}
          onClick={() => void cancel()}
        >
          {cancelling ? "Cancelling…" : waiting ? "Cancel pairing" : "Done"}
        </button>
      </div>
      {(error || statusError) && (
        <p className="error" role="alert">
          {error || statusError}
        </p>
      )}
      {creating ? (
        <p role="status">Creating a one-use code…</p>
      ) : progress.state === "claimed" ? (
        <div role="status">
          <p>
            <strong>{progress.machine?.name ?? "Your device"}</strong> is paired
            with your account.
          </p>
          <p>
            Choose local sharing permissions on that device. Pairing does not
            start a remote session.
          </p>
        </div>
      ) : progress.state === "expired" ||
        progress.state === "cancelled" ||
        progress.state === "unavailable" ? (
        <>
          <p role="status">
            {progress.state === "expired"
              ? "This code expired."
              : progress.state === "cancelled"
                ? "This code was cancelled."
                : "This code is no longer available."}
          </p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Create a new code
          </button>
        </>
      ) : invitation ? (
        <>
          <p>Open Beacon Remote on the device, choose its name, then enter:</p>
          <div className="pairing-field">
            <span>Workspace address</span>
            <div className="pairing-code-row">
              <code>{window.location.origin}</code>
              <button
                className="secondary"
                onClick={() => void copy(window.location.origin, "address")}
              >
                {copied === "address" ? "Copied" : "Copy address"}
              </button>
            </div>
          </div>
          <div className="pairing-field">
            <span>Pairing code</span>
            <div className="pairing-code-row">
              <code aria-label="Pairing code">
                {seconds > 0 ? invitation.code : "Checking expiry…"}
              </code>
              <button
                className="secondary"
                disabled={seconds <= 0}
                onClick={() => void copy(invitation.code, "code")}
              >
                {copied === "code" ? "Copied" : "Copy code"}
              </button>
            </div>
          </div>
          <p className="note">
            {seconds > 0
              ? `One use · expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
              : "Checking whether the code was used…"}
          </p>
          <div className="pairing-field">
            <span>On an Android phone with the app</span>
            <div className="pairing-code-row">
              <a
                href={pairingLink(window.location.origin, invitation.code)}
                aria-disabled={seconds <= 0}
              >
                Open this link on the phone
              </a>
              <button
                className="secondary"
                disabled={seconds <= 0}
                onClick={() =>
                  void copy(
                    pairingLink(window.location.origin, invitation.code),
                    "link",
                  )
                }
              >
                {copied === "link" ? "Copied" : "Copy link"}
              </button>
            </div>
            {seconds > 0 && (
              <PairingQr
                link={pairingLink(window.location.origin, invitation.code)}
              />
            )}
            <p className="note">
              Point the phone's camera at the square, or open the link. It fills
              in the address and code. Tap Pair on the phone to finish.
            </p>
          </div>
          <a href="#downloads">Get the Windows or Android app →</a>
        </>
      ) : (
        <button onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      )}
    </section>
  );
}
