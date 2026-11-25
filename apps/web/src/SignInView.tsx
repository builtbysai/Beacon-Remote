import { useEffect, useRef, useState } from "react";
import { SignInConnection } from "./signin-connection.js";
import { handoffDesktop, cancelSignInHandoff } from "./signin-handoff.js";
import type { ViewGrant } from "./LiveView.js";
import { attachRemoteInput } from "./remote-input.js";
import "./signin-view.css";

export function SignInView({
  machineId,
  name,
  signal,
  onClose,
  onDesktop,
}: {
  machineId: string;
  name: string;
  signal: AbortSignal;
  onClose: () => void;
  onDesktop: (grant: ViewGrant, transfer: () => void) => boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    shell = useRef<HTMLElement>(null),
    stopButton = useRef<HTMLButtonElement>(null);
  const connection = useRef<SignInConnection | null>(null);
  const desktopHandler = useRef(onDesktop);
  desktopHandler.current = onDesktop;
  const [status, setStatus] = useState("Connecting to Windows sign-in…"),
    [ended, setEnded] = useState(false),
    [input, setInput] = useState(false),
    [picture, setPicture] = useState(false),
    [needsPlay, setNeedsPlay] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [attentionPending, setAttentionPending] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;
    let handingOff = false;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background: { element: HTMLElement; inert: boolean }[] = [];
    for (
      let branch: HTMLElement | null = shell.current;
      branch?.parentElement;
      branch = branch.parentElement
    ) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
    }
    stopButton.current?.focus();
    const clear = () => {
      const element = video.current;
      if (element) {
        element.pause();
        element.srcObject = null;
      }
    };
    const play = () => {
      void video.current
        ?.play()
        .then(() => {
          if (!disposed) setNeedsPlay(false);
        })
        .catch(() => {
          if (!disposed) setNeedsPlay(true);
        });
    };
    void SignInConnection.start(
      machineId,
      {
        status: (message) => {
          if (!disposed) setStatus(message);
        },
        stream: (stream) => {
          const element = video.current;
          if (!element) return;
          if (!stream) {
            clear();
            if (!disposed) {
              setPicture(false);
              setInput(false);
            }
            return;
          }
          element.srcObject = stream;
          play();
        },
        input: (channel, scope) => {
          const element = video.current;
          if (!element) throw new Error();
          return attachRemoteInput(
            channel,
            scope.leaseId,
            element,
            (ready) => {
              if (!disposed) setInput(ready);
            },
            () => connection.current?.fail(),
            () => "trackpad",
            (message) => {
              if (!disposed) setStatus(message);
            },
            () => {},
            {
              ...scope,
              attentionState: (pending) => {
                if (!disposed) setAttentionPending(pending);
              },
            },
          );
        },
        ended: (reason) => {
          if (!disposed) {
            setInput(false);
            setPicture(false);
            const active = connection.current,
              context = active?.handoffContext();
            if (
              reason === "unavailable" &&
              active &&
              context &&
              !handingOff &&
              !signal.aborted &&
              !abort.signal.aborted
            ) {
              handingOff = true;
              setEnded(false);
              void handoffDesktop(
                machineId,
                context,
                AbortSignal.any([signal, abort.signal]),
                (message) => {
                  if (!disposed) setStatus(message);
                },
              )
                .then((grant) => {
                  if (
                    disposed ||
                    signal.aborted ||
                    abort.signal.aborted ||
                    !desktopHandler.current(grant, () => active.transfer())
                  )
                    void cancelSignInHandoff(context.leaseId, grant.id);
                })
                .catch(() => {
                  if (!disposed) {
                    setEnded(true);
                    setStatus(
                      "Sign-in connection ended. Return to Computers to reconnect.",
                    );
                  }
                });
              return;
            }
            active?.stop();
            setEnded(true);
            setStatus(
              reason === "expired"
                ? "Sign-in access expired."
                : reason === "stopped"
                  ? "Control stopped."
                  : "Sign-in connection ended. Return to Computers to reconnect.",
            );
          }
        },
      },
      AbortSignal.any([signal, abort.signal]),
    )
      .then((active) => {
        if (disposed) {
          active.stop();
          return;
        }
        connection.current = active;
      })
      .catch(() => {
        if (!disposed) {
          setEnded(true);
          setStatus(
            "Windows sign-in is unavailable. Check this computer’s access and try again.",
          );
        }
      });
    const pagehide = () => abort.abort();
    const fullscreenChange = () => {
      const active = document.fullscreenElement === shell.current;
      setFullscreen(active);
      if (!active)
        (
          navigator as Navigator & { keyboard?: { unlock?: () => void } }
        ).keyboard?.unlock?.();
    };
    document.addEventListener("fullscreenchange", fullscreenChange);
    const firstFrame = setTimeout(() => {
      if ((video.current?.readyState ?? 0) < 2) {
        if (connection.current) connection.current.fail();
        else abort.abort();
      }
    }, 10000);
    window.addEventListener("pagehide", pagehide);
    return () => {
      disposed = true;
      clearTimeout(firstFrame);
      abort.abort();
      connection.current?.stop();
      connection.current = null;
      clear();
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("fullscreenchange", fullscreenChange);
      document.body.style.overflow = previousOverflow;
      for (const { element, inert } of background) element.inert = inert;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [machineId, signal]);
  const close = () => {
    connection.current?.stop();
    onClose();
  };
  return (
    <section
      ref={shell}
      className={`live-view signin-view${input && picture ? " is-controlling" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} Windows sign-in`}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(
          shell.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),video[tabindex="0"]',
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="viewer-toolbar">
        <div className="viewer-identity">
          <strong>{name}</strong>
          <span>Windows sign-in</span>
        </div>
        <div className="viewer-actions">
          {input && picture && !ended && (
            <button
              className="viewer-control"
              disabled={attentionPending}
              onClick={() =>
                video.current?.dispatchEvent(
                  new Event("beacon-secure-attention"),
                )
              }
            >
              Ctrl+Alt+Delete
            </button>
          )}
          {input && picture && !ended && (
            <button
              className="viewer-control"
              onClick={() =>
                video.current?.dispatchEvent(new Event("beacon-keyboard"))
              }
            >
              Keyboard
            </button>
          )}
          {!ended && (
            <button
              className="viewer-control"
              onClick={() => {
                if (document.fullscreenElement === shell.current) {
                  void document.exitFullscreen().catch(() => {});
                  return;
                }
                void shell.current
                  ?.requestFullscreen()
                  .then(() =>
                    (
                      navigator as Navigator & {
                        keyboard?: { lock?: () => Promise<void> };
                      }
                    ).keyboard?.lock?.(),
                  )
                  .catch(() => {});
              }}
            >
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          )}
          <button className="viewer-stop" ref={stopButton} onClick={close}>
            {ended ? "Close" : "Stop control"}
          </button>
        </div>
      </header>
      <div className="viewer-stage fit">
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          tabIndex={input && picture && !ended ? 0 : -1}
          aria-label="Windows sign-in screen. Shift+Escape stops control."
          onLoadedData={() => {
            if (connection.current?.canInput()) setPicture(true);
          }}
        />
        {!picture && (
          <p className="viewer-placeholder" role="status">
            {status}
          </p>
        )}
        {needsPlay && !ended && (
          <button
            className="viewer-play"
            onClick={() => {
              void video.current
                ?.play()
                .then(() => setNeedsPlay(false))
                .catch(() => setNeedsPlay(true));
            }}
          >
            Show screen
          </button>
        )}
      </div>
      <p className="viewer-status" role="status">
        {status}
      </p>
    </section>
  );
}
