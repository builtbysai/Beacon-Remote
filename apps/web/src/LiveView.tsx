import { useEffect, useRef, useState } from "react";
import { playForSession } from "./playback.js";
import { viewDeadline } from "./deadline.js";

export type ViewGrant = {
  id: string;
  source: "synthetic" | "desktop";
  expiresAtMillis: number;
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
};

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
  const [displayError, setDisplayError] = useState("");
  const [status, setStatus] = useState(
    grant.source === "desktop"
      ? "Approve this request on your Windows computer…"
      : "Waiting for the Windows helper…",
  );
  const [frames, setFrames] = useState(0);
  const [ended, setEnded] = useState(false);
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
  const [roundTripMillis, setRoundTripMillis] = useState<number | null>(null);
  useEffect(() => {
    const sync = () =>
      setIsFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    const startedAt = performance.now();
    const expired = viewDeadline(
      grant.expiresAtMillis,
      () => Date.now(),
      () => performance.now(),
    );
    let approvedAt: number | undefined;
    let firstFrameAt: number | undefined;
    const pc = new RTCPeerConnection({
      iceServers: grant.iceServers,
      iceTransportPolicy: grant.iceTransportPolicy,
    });
    setPolicy(pc.getConfiguration().iceTransportPolicy ?? "all");
    const url = new URL(
      `/api/sessions/${grant.id}/signal?role=viewer`,
      window.location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    let closed = false;
    let messages = 0;
    let serial = Promise.resolve();
    const candidates: RTCIceCandidateInit[] = [];
    let frameCallback = 0;
    let lastCount = 0;
    let previousFrames = 0;
    const element = video.current;
    function finish(reason: string) {
      if (closed) return;
      closed = true;
      setStatus(reason);
      setEnded(true);
      setNeedsPlay(false);
      pc.close();
      ws.close();
      candidates.length = 0;
      if (element) {
        element.cancelVideoFrameCallback?.(frameCallback);
        element.pause();
        element.srcObject = null;
      }
      void fetch(`/api/sessions/${grant.id}/stop`, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
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
                ? "Connected — view only."
                : "Connected — synthetic video only.",
            );
        },
        () => {
          setNeedsPlay(true);
          setStatus("Press Play to view the stream.");
        },
      );
    const send = (body: unknown) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 131072) {
        finish("Connection stalled.");
        return;
      }
      ws.send(JSON.stringify(body));
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
      if (pc.connectionState === "connected") {
        setStatus(
          grant.source === "desktop"
            ? "Connected — view only."
            : "Connected — synthetic video only.",
        );
      }
      // The native helper ends the lease on disconnection. Never suggest
      // that this already-ended request can reconnect without fresh approval.
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      )
        finish("Video connection interrupted. Request viewing again.");
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
    ws.onerror = () => finish("Signaling connection failed.");
    ws.onclose = () => finish("Session ended.");
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
            case "joined":
              break;
            case "consent":
              if (message.accepted !== true)
                finish("Sharing was declined on Windows.");
              else {
                approvedAt ??= performance.now();
                setTimings((current) => ({
                  ...current,
                  approval: approvedAt! - startedAt,
                }));
                setStatus("Connecting video…");
              }
              break;
            case "offer": {
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
    const onPageHide = () => finish("Stopped.");
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
      finish("Stopped.");
    };
  }, [grant]);
  return (
    <section
      ref={shell}
      className="live-view"
      aria-label={`${name} remote viewer`}
    >
      <header className="viewer-toolbar">
        <div className="viewer-identity">
          <strong>{name}</strong>
          <span>{grant.source === "desktop" ? "View only" : "Video test"}</span>
        </div>
        <div className="viewer-actions">
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
                ? "Stop viewing"
                : "Stop video test"}
          </button>
        </div>
      </header>
      <div className={`viewer-stage ${scale}`}>
        <video
          ref={video}
          autoPlay
          muted
          playsInline
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
        {route !== "Not established" && <span>{route}</span>}
        {displayError && <span role="alert">{displayError}</span>}
      </footer>
    </section>
  );
}
