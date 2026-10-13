import { FileSender, type Offer, type Transfer } from "./file-transfer.js";
import { useEffect, useRef, useState } from "react";
import { playForSession } from "./playback.js";
import { viewDeadline } from "./deadline.js";
import { rememberView, forgetView } from "./resume-view.js";
import { peerLifetime } from "./peer-lifetime.js";
import { recoverTransport } from "./recover-transport.js";
import { reconnectUntil } from "./reconnect.js";
import { attachRemoteInput } from "./remote-input.js";
import type { TouchMode } from "./touch-input.js";
import { api } from "./api.js";

export type ViewGrant = {
  id: string;
  source: "synthetic" | "desktop";
  capability?: "desktop:view" | "desktop:control";
  expiresAtMillis: number;
  // How long the server holds the session for a viewer that dropped; the viewer retries that long.
  reconnectSeconds?: number;
  // "policy" when the computer's own trusted-access setting approved it, so no one is asked.
  approval?: "local" | "policy";
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
};

function transferLine(transfer: Transfer): string {
  const percent = transfer.size
    ? Math.floor((transfer.sent / transfer.size) * 100)
    : 0;
  if (transfer.incoming) {
    if (transfer.status === "receiving")
      return `Receiving ${transfer.name} · ${percent}%`;
    if (transfer.status === "done") return `Received ${transfer.name}`;
    if (transfer.status === "cancelled")
      return `Cancelled ${transfer.name}${transfer.note ? `. ${transfer.note}` : ""}`;
    return `Could not receive ${transfer.name}. ${transfer.note ?? ""}`;
  }
  if (transfer.status === "sending" || transfer.status === "waiting")
    return `Sending ${transfer.name} · ${percent}%`;
  if (transfer.status === "done")
    return `Sent ${transfer.name}${
      transfer.note && transfer.note !== transfer.name
        ? ` (saved as ${transfer.note})`
        : ""
    }`;
  if (transfer.status === "cancelled") return `Cancelled ${transfer.name}`;
  return `Could not send ${transfer.name}. ${transfer.note ?? ""}`;
}

export function LiveView({
  grant,
  name,
  onClose,
}: {
  grant: ViewGrant;
  name: string;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLElement>(null);
  const stop = useRef<() => void>(() => {});
  const play = useRef<() => Promise<void>>(async () => {});
  const [scale, setScale] = useState<"fit" | "actual">("fit");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  // The person at the computer paused sharing; screen and input are off until they resume.
  const [peerPaused, setPeerPaused] = useState(false);
  const [displayError, setDisplayError] = useState("");
  const [status, setStatus] = useState(
    grant.source === "desktop"
      ? grant.approval === "policy"
        ? "Connecting…"
        : "Approve this request on your Windows computer…"
      : "Waiting for the Windows helper…",
  );
  const [frames, setFrames] = useState(0);
  const [ended, setEnded] = useState(false);
  const [controlReady, setControlReady] = useState(false);
  const [touchMode, setTouchMode] = useState<TouchMode>("trackpad");
  const touchModeRef = useRef(touchMode);
  touchModeRef.current = touchMode;
  const controlling = grant.capability === "desktop:control";
  async function sendFiles(list: FileList | File[]) {
    const current = sender.current;
    if (!current || sending.current) return;
    sending.current = true;
    try {
      for (const file of Array.from(list)) await current.send(file);
    } finally {
      sending.current = false;
    }
  }
  const [route, setRoute] = useState("Not established");
  const [iceState, setIceState] = useState<RTCIceConnectionState>("new");
  const [localRelays, setLocalRelays] = useState(0);
  const [remoteRelays, setRemoteRelays] = useState(0);
  const [iceError, setIceError] = useState<number | null>(null);
  const [policy, setPolicy] = useState<RTCIceTransportPolicy>(
    grant.iceTransportPolicy,
  );
  const [candidateTypes, setCandidateTypes] = useState("Not established");
  const [timings, setTimings] = useState<{
    approval?: number;
    firstFrame?: number;
    afterApproval?: number;
  }>({});
  const [presentedFps, setPresentedFps] = useState<number | null>(null);
  const [pictureHeight, setPictureHeight] = useState<number | null>(null);
  // File transfer exists only when the person at the computer allowed it for this session.
  const sender = useRef<FileSender | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileReady, setFileReady] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const sending = useRef(false);
  const [roundTripMillis, setRoundTripMillis] = useState<number | null>(null);
  const [transportAttempt, setTransportAttempt] = useState(0);
  // Relay credentials are short; each resume brings fresh ones for the next transport.
  const ice = useRef({ id: grant.id, servers: grant.iceServers });
  if (ice.current.id !== grant.id)
    ice.current = { id: grant.id, servers: grant.iceServers };
  useEffect(() => {
    const sync = () =>
      setIsFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  // On a phone, full screen means landscape with the picture filling the screen and the toolbar
  // folded into one button. Browsers that cannot lock orientation just stay as they are.
  const touchDevice =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const compact = isFullscreen && touchDevice;
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!compact) {
      setMenuOpen(false);
      return;
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (mode: string) => Promise<void>;
    };
    void orientation.lock?.("landscape").catch(() => undefined);
    return () => orientation.unlock?.();
  }, [compact]);
  useEffect(() => {
    const startedAt = performance.now();
    const expired = viewDeadline(
      grant.expiresAtMillis,
      () => Date.now(),
      () => performance.now(),
    );
    let approvedAt: number | undefined;
    let firstFrameAt: number | undefined;
    setEnded(false);
    setFrames(0);
    setNeedsPlay(false);
    setTimings({});
    if (transportAttempt > 0) setStatus("Reconnecting video…");
    const pc = new RTCPeerConnection({
      iceServers: ice.current.servers,
      iceTransportPolicy: grant.iceTransportPolicy,
      iceCandidatePoolSize: 1,
    });
    setPolicy(pc.getConfiguration().iceTransportPolicy ?? "all");
    const url = new URL(
      `/api/sessions/${grant.id}/signal?role=viewer`,
      window.location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    let closed = false;
    let detachInput: (() => void) | undefined;
    let inputChannel: RTCDataChannel | undefined;
    let finished = false;
    let recovering = false;
    let replaced = false;
    let socketClosed = () => {};
    const recoveryAbort = new AbortController();
    let resumable = false;
    let controlGranted = true;
    let generation = 0;
    let messages = 0;
    let serial = Promise.resolve();
    const candidates: RTCIceCandidateInit[] = [];
    let frameCallback = 0;
    let lastCount = 0;
    let previousFrames = 0;
    const element = video.current;
    const peer = peerLifetime(
      () => setStatus("Reconnecting video…"),
      () => void reconnect(),
    );
    function closeTransport() {
      if (closed) return;
      closed = true;
      detachInput?.();
      peer.dispose();
      pc.close();
      ws.close();
      candidates.length = 0;
      if (element) {
        element.cancelVideoFrameCallback?.(frameCallback);
        element.pause();
        element.srcObject = null;
      }
    }
    function stopRequest() {
      return api(`sessions/${grant.id}/stop`, {}).catch(() => {});
    }
    function finish(reason: string, reloading = false) {
      if (finished) return;
      finished = true;
      recoveryAbort.abort();
      if (!reloading) forgetView();
      setStatus(reason);
      setEnded(true);
      setNeedsPlay(false);
      closeTransport();
      if (!reloading)
        void fetch(`/api/sessions/${grant.id}/stop`, {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }).catch(() => {});
    }
    async function reconnect() {
      if (finished || recovering) return;
      if (!resumable || expired()) {
        finish("Video connection interrupted. Request viewing again.");
        return;
      }
      recovering = true;
      setStatus("Reconnecting…");
      setFrames(0);
      const closedSocket = new Promise<void>((resolve) => {
        socketClosed = resolve;
        if (ws.readyState === WebSocket.CLOSED) resolve();
      });
      closeTransport();
      try {
        // Wait for the old socket close handshake so the server can detach its
        // sole viewer before authorizing the original login's replacement.
        await Promise.race([
          closedSocket,
          new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ]);
        // A network outage is retried for as long as the server holds the session. Only the
        // server refusing (signed out, revoked, stopped, expired) ends it.
        const resumed = await reconnectUntil({
          attempt: () =>
            recoverTransport(
              grant,
              () => {
                const abort = new AbortController();
                const timer = setTimeout(() => abort.abort(), 5000);
                return api<ViewGrant>(
                  `sessions/${grant.id}/resume`,
                  {},
                  abort.signal,
                ).finally(() => clearTimeout(timer));
              },
              () => !finished && !expired(),
              stopRequest,
            ),
          isCurrent: () => !finished && !expired(),
          windowMs: (grant.reconnectSeconds ?? 120) * 1000,
        });
        if (!resumed) return;
        ice.current = { id: grant.id, servers: resumed.iceServers };
        replaced = true;
        setTransportAttempt((value) => value + 1);
      } catch {
        if (!finished) finish("Could not reconnect. Request viewing again.");
      }
    }
    stop.current = () => finish("Stopped.");
    play.current = () =>
      playForSession(
        () => element?.play() ?? Promise.resolve(),
        () => !closed && element !== null,
        () => {
          setNeedsPlay(false);
          if (pc.connectionState === "connected")
            setStatus(
              grant.source === "desktop"
                ? controlling && controlGranted
                  ? "Connected — click the desktop to control. Escape releases input."
                  : controlling
                    ? "Connected — view only. Control was not allowed on the computer."
                    : "Connected — view only."
                : "Connected — synthetic video only.",
            );
        },
        () => {
          setNeedsPlay(true);
          setStatus("Press Play to view the stream.");
        },
      );
    const send = (body: Record<string, unknown>) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 131072) {
        finish("Connection stalled.");
        return;
      }
      ws.send(JSON.stringify({ ...body, generation }));
    };
    pc.ondatachannel = (event) => {
      if (
        event.channel.label === "beacon-files-v1" &&
        grant.source === "desktop" &&
        !sender.current &&
        event.channel.ordered
      ) {
        sender.current = new FileSender(
          event.channel,
          setTransfer,
          setFileReady,
          setOffer,
        );
        return;
      }
      if (
        !controlling ||
        !element ||
        inputChannel ||
        event.channel.label !== "beacon-input-v1" ||
        !event.channel.ordered ||
        event.channel.maxRetransmits !== null ||
        event.channel.maxPacketLifeTime !== null
      ) {
        event.channel.close();
        finish("Unexpected input channel.");
        return;
      }
      inputChannel = event.channel;
      detachInput = attachRemoteInput(
        event.channel,
        grant.id,
        element,
        setControlReady,
        () => finish("Control connection ended. Request control again."),
        () => touchModeRef.current,
        setDisplayError,
      );
    };
    pc.onicecandidate = (event) => {
      if (closed) return;
      if (event.candidate) {
        if (event.candidate.type === "relay") setLocalRelays((n) => n + 1);
        send({
          type: "candidate",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (!closed) setIceState(pc.iceConnectionState);
    };
    pc.onicecandidateerror = (event) => {
      if (!closed) setIceError(event.errorCode);
    };
    pc.onconnectionstatechange = () => {
      if (closed) return;
      if (
        controlling &&
        !resumable &&
        ["disconnected", "failed", "closed"].includes(pc.connectionState)
      ) {
        finish("Control connection ended. Request control again.");
        return;
      }
      peer.update(pc.connectionState);
      if (pc.connectionState === "connected") {
        setStatus(
          grant.source === "desktop"
            ? controlling && controlGranted
              ? "Connected — click the desktop to control. Escape releases input."
              : controlling
                ? "Connected — view only. Control was not allowed on the computer."
                : "Connected — view only."
            : "Connected — synthetic video only.",
        );
      }
    };
    pc.ontrack = (event) => {
      if (!element || closed || event.track.kind !== "video") return;
      element.srcObject = new MediaStream([event.track]);
      void play.current();
      if (element.requestVideoFrameCallback) {
        const count: VideoFrameRequestCallback = (time, metadata) => {
          if (closed) return;
          if (firstFrameAt === undefined) {
            firstFrameAt = time;
            setTimings((current) => ({
              ...current,
              firstFrame: Math.max(0, time - startedAt),
              afterApproval:
                approvedAt === undefined
                  ? undefined
                  : Math.max(0, time - approvedAt),
            }));
          }
          if (time - lastCount >= 1000 || lastCount === 0) {
            setFrames(metadata.presentedFrames);
            setPictureHeight(metadata.height);
            if (lastCount !== 0)
              setPresentedFps(
                Math.max(
                  0,
                  ((metadata.presentedFrames - previousFrames) * 1000) /
                    (time - lastCount),
                ),
              );
            previousFrames = metadata.presentedFrames;
            lastCount = time;
          }
          frameCallback = element.requestVideoFrameCallback(count);
        };
        frameCallback = element.requestVideoFrameCallback(count);
      }
    };
    // A dropped signaling connection is a network problem, not the end of the session.
    ws.onerror = () => {
      if (recovering) return;
      if (resumable) void reconnect();
      else finish("Signaling connection failed.");
    };
    ws.onclose = () => {
      socketClosed();
      if (recovering) return;
      if (resumable && !closed) void reconnect();
      else finish("Session ended.");
    };
    ws.onmessage = (event) => {
      if (closed) return;
      if (
        typeof event.data !== "string" ||
        event.data.length > 65536 ||
        ++messages > 96
      ) {
        finish("Invalid signaling.");
        return;
      }
      serial = serial
        .then(async () => {
          if (closed) return;
          const message = JSON.parse(event.data) as Record<string, unknown>;
          switch (message.type) {
            case "retry":
              if (message.generation === generation && resumable)
                void reconnect();
              break;
            case "joined":
              if (
                typeof message.generation === "number" &&
                Number.isInteger(message.generation) &&
                message.generation >= 0 &&
                message.generation <= 1024
              )
                generation = message.generation;
              break;
            case "consent":
              if (message.accepted !== true)
                finish("Sharing was declined on Windows.");
              else {
                resumable = message.resumable === true;
                // The person at the computer may allow viewing but not the control that was asked for.
                if (message.control === false) controlGranted = false;
                if (resumable) rememberView({ id: grant.id, name });
                approvedAt ??= performance.now();
                setTimings((current) => ({
                  ...current,
                  approval: approvedAt! - startedAt,
                }));
                setStatus("Connecting video…");
              }
              break;
            case "offer": {
              if ((message.generation ?? 0) !== generation) break;
              if (
                pc.remoteDescription ||
                typeof message.sdp !== "string" ||
                message.sdp.length > 32768
              )
                throw new Error("Invalid offer");
              await pc.setRemoteDescription({
                type: "offer",
                sdp: message.sdp,
              });
              if (closed) return;
              for (const candidate of candidates.splice(0))
                await pc.addIceCandidate(candidate);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              send({ type: "answer", sdp: answer.sdp });
              break;
            }
            case "candidate": {
              if ((message.generation ?? 0) !== generation) break;
              if (
                typeof message.candidate !== "string" ||
                message.candidate.length > 2048 ||
                candidates.length >= 16
              )
                throw new Error("Invalid candidate");
              const candidate = {
                candidate: message.candidate,
                sdpMid: message.sdpMid as string | null,
                sdpMLineIndex: message.sdpMLineIndex as number | null,
              };
              if (/\btyp relay\b/.test(candidate.candidate))
                setRemoteRelays((n) => n + 1);
              if (pc.remoteDescription) await pc.addIceCandidate(candidate);
              else candidates.push(candidate);
              break;
            }
            case "paused":
              if (typeof message.paused !== "boolean")
                throw new Error("Invalid pause");
              setPeerPaused(message.paused);
              break;
            case "ended":
              finish("Session ended.");
              break;
            default:
              throw new Error("Unexpected signaling");
          }
        })
        .catch(() => finish("Could not establish video."));
    };
    const timer = setInterval(() => {
      if (expired()) finish("Session expired.");
    }, 500);
    const onPageHide = () => finish("Reconnecting…", resumable);
    window.addEventListener("pagehide", onPageHide);
    let inspecting = false;
    const diagnostics = setInterval(() => {
      if (closed || inspecting || pc.connectionState !== "connected") return;
      inspecting = true;
      void pc
        .getStats()
        .then((stats) => {
          if (closed) return;
          const reports = new Map<
            string,
            {
              localCandidateId?: string;
              remoteCandidateId?: string;
              candidateType?: string;
              currentRoundTripTime?: number;
            }
          >();
          let selected: string | undefined;
          stats.forEach((report) => {
            reports.set(report.id, report);
            if (
              report.type === "transport" &&
              typeof report.selectedCandidatePairId === "string"
            )
              selected = report.selectedCandidatePairId;
          });
          const pair = selected ? reports.get(selected) : undefined;
          if (!pair) return;
          const rtt = pair.currentRoundTripTime;
          setRoundTripMillis(
            typeof rtt === "number" && Number.isFinite(rtt) && rtt >= 0
              ? rtt * 1000
              : null,
          );
          const local =
            reports.get(pair.localCandidateId ?? "")?.candidateType ?? "";
          const remote =
            reports.get(pair.remoteCandidateId ?? "")?.candidateType ?? "";
          setCandidateTypes(`${local || "unknown"} / ${remote || "unknown"}`);
          // Chrome can report a peer-reflexive selected candidate even when
          // relay-only policy is enforced. Do not label that path as direct.
          if (
            pc.getConfiguration().iceTransportPolicy === "relay" ||
            local === "relay" ||
            remote === "relay"
          )
            setRoute("Relayed");
          else if (
            ["host", "srflx"].includes(local) &&
            ["host", "srflx"].includes(remote)
          )
            setRoute("Direct");
          else setRoute("Unavailable");
        })
        .catch(() => {
          if (!closed) setRoute("Unavailable");
        })
        .finally(() => {
          inspecting = false;
        });
    }, 2000);
    return () => {
      clearInterval(timer);
      clearInterval(diagnostics);
      window.removeEventListener("pagehide", onPageHide);
      if (!replaced) finish("Stopped.");
      else closeTransport();
    };
  }, [grant, transportAttempt]);
  // A pending transport replacement must never suppress Stop on navigation or
  // unmount. This cleanup does not run between attempts of the same grant.
  useEffect(() => () => stop.current(), [grant]);
  return (
    <section
      ref={shell}
      className="live-view"
      aria-label={`${name} remote viewer`}
    >
      <header className={`viewer-toolbar${compact ? " compact" : ""}`}>
        <div className="viewer-identity">
          <strong>{name}</strong>
          <span>
            {grant.source === "desktop"
              ? controlling
                ? "Mouse and keyboard"
                : "View only"
              : "Video test"}
            {grant.expiresAtMillis === 0 ? " · Until stopped" : ""}
          </span>
        </div>
        {compact && (
          <button
            className="viewer-control viewer-menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Hide" : "Menu"}
          </button>
        )}
        <div className="viewer-actions" hidden={compact && !menuOpen}>
          <label className="viewer-scale">
            Scale
            <select
              aria-label="Video scale"
              value={scale}
              onChange={(event) =>
                setScale(event.target.value as "fit" | "actual")
              }
            >
              <option value="fit">Fit</option>
              <option value="actual">100%</option>
            </select>
          </label>
          {controlReady && (
            <button
              className="viewer-control"
              title="Open your keyboard to type on the remote computer"
              onClick={() =>
                video.current?.dispatchEvent(new Event("beacon-keyboard"))
              }
            >
              Keyboard
            </button>
          )}
          {controlReady && (
            <button
              className="viewer-control"
              title="Copy the computer's clipboard text to this device"
              onClick={() =>
                video.current?.dispatchEvent(new Event("beacon-clipboard-read"))
              }
            >
              Copy from computer
            </button>
          )}
          {controlReady && (
            <button
              className="viewer-control"
              aria-pressed={touchMode === "direct"}
              title="Trackpad moves the cursor like a laptop touchpad. Touch acts where you tap."
              onClick={() =>
                setTouchMode((mode) =>
                  mode === "trackpad" ? "direct" : "trackpad",
                )
              }
            >
              Touch: {touchMode === "trackpad" ? "Trackpad" : "Direct"}
            </button>
          )}
          <button
            className="viewer-control"
            onClick={async () => {
              try {
                if (isFullscreen) await document.exitFullscreen();
                else await shell.current?.requestFullscreen();
                setDisplayError("");
              } catch {
                setDisplayError("Full screen is unavailable in this browser.");
              }
            }}
          >
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
          {fileReady && (
            <>
              <button
                className="viewer-control"
                title="Send a file to this computer. It is saved in Downloads\Beacon Remote."
                disabled={transfer?.status === "sending"}
                onClick={() => fileInput.current?.click()}
              >
                Send file
              </button>
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={(event) => {
                  const picked = event.currentTarget.files;
                  if (picked?.length) void sendFiles(picked);
                  event.currentTarget.value = "";
                }}
              />
            </>
          )}
          <details className="viewer-diagnostics">
            <summary>Connection</summary>
            <div className="viewer-diagnostics-panel">
              <p>Decoded frames: {frames}</p>
              <p>
                Presented FPS:{" "}
                {presentedFps === null
                  ? "Not measured"
                  : presentedFps.toFixed(1)}
              </p>
              <p>
                Round trip:{" "}
                {roundTripMillis === null
                  ? "Not measured"
                  : `${Math.round(roundTripMillis)} ms`}
              </p>
              <p>
                {grant.source === "desktop"
                  ? "Approval received"
                  : "Host ready"}
                :{" "}
                {timings.approval === undefined
                  ? "Pending"
                  : `${Math.round(timings.approval)} ms`}
              </p>
              <p>
                First presented frame:{" "}
                {timings.firstFrame === undefined
                  ? "Not received"
                  : `${Math.round(timings.firstFrame)} ms`}
              </p>
              <p>
                Approval to first frame:{" "}
                {timings.afterApproval === undefined
                  ? "Not measured"
                  : `${Math.round(timings.afterApproval)} ms`}
              </p>
              <p>
                Timings start at viewer setup. Approval time includes the
                person's response; it does not measure when the Windows dialog
                appeared. Presented FPS can drop when this browser tab is
                hidden.
              </p>
              <p>Connection route: {route}</p>
              <p>ICE state: {iceState}</p>
              <p>Browser ICE policy: {policy}</p>
              <p>Selected candidate types: {candidateTypes}</p>
              <p>
                Relay candidates: browser {localRelays}, Windows {remoteRelays}
              </p>
              {iceError !== null && <p>ICE server error code: {iceError}</p>}
            </div>
          </details>
          <button
            className="viewer-stop"
            onClick={() => {
              stop.current();
              onClose();
            }}
          >
            {ended
              ? "Close"
              : grant.source === "desktop"
                ? controlling
                  ? "Stop control"
                  : "Stop viewing"
                : "Stop video test"}
          </button>
        </div>
      </header>
      <div
        className={`viewer-stage ${scale}`}
        onDragOver={(event) => {
          if (fileReady) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!fileReady) return;
          event.preventDefault();
          if (event.dataTransfer.files.length)
            void sendFiles(event.dataTransfer.files);
        }}
      >
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          tabIndex={controlReady && !ended ? 0 : -1}
          className={controlReady && !ended ? "input-enabled" : undefined}
          aria-label={
            grant.source === "desktop"
              ? "Windows desktop video"
              : "Synthetic Windows video"
          }
        />
        {(frames === 0 || ended) && (
          <p className="viewer-placeholder" aria-hidden="true">
            {status}
          </p>
        )}
        {peerPaused && !ended && (
          <p className="viewer-paused" role="status">
            Sharing is paused by the person at the computer. Screen and input
            resume when they choose.
          </p>
        )}
        {needsPlay && !ended && (
          <button className="viewer-play" onClick={() => void play.current()}>
            Play video
          </button>
        )}
      </div>
      <footer className="viewer-status">
        <span role="status" data-decoded-frames={frames}>
          {status}
        </span>
        {offer && (
          <span role="status" className="viewer-transfer">
            The computer wants to send {offer.name} (
            {(offer.size / 1_048_576).toFixed(offer.size < 10_485_760 ? 1 : 0)}{" "}
            MB).{" "}
            <button
              className="viewer-control"
              onClick={() => sender.current?.accept(offer)}
            >
              Save
            </button>{" "}
            <button
              className="viewer-control"
              onClick={() => sender.current?.decline(offer)}
            >
              Decline
            </button>
          </span>
        )}
        {transfer && (
          <span role="status" className="viewer-transfer">
            {transferLine(transfer)}
            {(transfer.status === "sending" ||
              transfer.status === "waiting" ||
              transfer.status === "receiving") && (
              <>
                {" "}
                <button
                  className="viewer-control"
                  onClick={() => sender.current?.cancel()}
                >
                  Cancel
                </button>
              </>
            )}
          </span>
        )}
        {route !== "Not established" && (
          <span className="viewer-quality">
            {[
              route,
              pictureHeight ? `${pictureHeight}p` : null,
              presentedFps === null ? null : `${Math.round(presentedFps)} fps`,
              roundTripMillis === null
                ? null
                : `${Math.round(roundTripMillis)} ms`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {displayError && <span role="alert">{displayError}</span>}
      </footer>
    </section>
  );
}
