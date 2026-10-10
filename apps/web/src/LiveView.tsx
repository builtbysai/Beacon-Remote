import { useEffect, useRef, useState } from "react";

export type ViewGrant = {
  id: string;
  expiresAtMillis: number;
  iceServers: RTCIceServer[];
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
  const [status, setStatus] = useState("Waiting for the Windows helper…");
  const [frames, setFrames] = useState(0);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const pc = new RTCPeerConnection({ iceServers: grant.iceServers });
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
      if (event.candidate)
        send({
          type: "candidate",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected")
        setStatus("Connected — synthetic video only.");
      if (["failed", "disconnected"].includes(pc.connectionState))
        finish("Video connection interrupted.");
    };
    pc.ontrack = (event) => {
      if (!element || closed || event.track.kind !== "video") return;
      element.srcObject = new MediaStream([event.track]);
      void element.play().catch(() => {
        setStatus("Press Play to view the stream.");
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
    return () => {
      clearInterval(timer);
      finish("Stopped.");
    };
  }, [grant]);
  return (
    <aside className="live-view">
      <h2>{name} — video connection test</h2>
      <p>
        Synthetic video only. Your desktop, microphone and input are not shared.
      </p>
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        controls
        aria-label="Synthetic Windows video"
      />
      <p role="status" data-decoded-frames={frames}>
        {status}
        {frames > 0 ? ` Decoded frames: ${frames}.` : ""}
      </p>
      <button
        onClick={() => {
          stop.current();
          onClose();
        }}
      >
        {ended ? "Close" : "Stop video test"}
      </button>
    </aside>
  );
}
