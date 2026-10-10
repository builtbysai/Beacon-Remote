import { useEffect, useRef, useState } from "react";

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
  const stop = useRef<() => void>(() => {});
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
  useEffect(() => {
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
    const element = video.current;
    function finish(reason: string) {
      if (closed) return;
      closed = true;
      setStatus(reason);
      setEnded(true);
      pc.close();
      ws.close();
      candidates.length = 0;
      if (element) {
        element.cancelVideoFrameCallback?.(frameCallback);
        element.srcObject = null;
      }
      void fetch(`/api/sessions/${grant.id}/stop`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {});
    }
    stop.current = () => finish("Stopped.");
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
      if (pc.connectionState === "connected")
        setStatus(
          grant.source === "desktop"
            ? "Connected — view only."
            : "Connected — synthetic video only.",
        );
      if (["failed", "disconnected"].includes(pc.connectionState))
        finish("Video connection interrupted.");
    };
    pc.ontrack = (event) => {
      if (!element || closed || event.track.kind !== "video") return;
      element.srcObject = new MediaStream([event.track]);
      void element.play().catch(() => {
        if (!closed) setStatus("Press Play to view the stream.");
      });
      if (element.requestVideoFrameCallback) {
        const count: VideoFrameRequestCallback = (time, metadata) => {
          if (closed) return;
          if (time - lastCount >= 1000 || lastCount === 0) {
            setFrames(metadata.presentedFrames);
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
              else setStatus("Connecting video…");
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
      if (Date.now() >= grant.expiresAtMillis) finish("Session expired.");
    }, 500);
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
      finish("Stopped.");
    };
  }, [grant]);
  return (
    <aside className="live-view">
      <h2>
        {name} —{" "}
        {grant.source === "desktop" ? "desktop view" : "video connection test"}
      </h2>
      <p>
        {grant.source === "desktop"
          ? "View only. Sharing requires approval on Windows and ends after two minutes. Microphone, recording and remote input are disabled."
          : "Synthetic video only. Your desktop, microphone and input are not shared."}
      </p>
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        controls
        aria-label={
          grant.source === "desktop"
            ? "Windows desktop video"
            : "Synthetic Windows video"
        }
      />
      <p role="status" data-decoded-frames={frames}>
        {status}
      </p>
      <details>
        <summary>Connection diagnostics</summary>
        <p>Decoded frames: {frames}</p>
        <p>Connection route: {route}</p>
        <p>ICE state: {iceState}</p>
        <p>Browser ICE policy: {policy}</p>
        <p>Selected candidate types: {candidateTypes}</p>
        <p>
          Relay candidates: browser {localRelays}, Windows {remoteRelays}
        </p>
        {iceError !== null && <p>ICE server error code: {iceError}</p>}
      </details>
      {grant.source === "desktop" && !ended && (
        <div className="actions">
          <button disabled title="Pause and resume are not available yet">
            Pause sharing
          </button>
          <button disabled title="This session permits viewing only">
            Request control
          </button>
        </div>
      )}
      <button
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
    </aside>
  );
}
