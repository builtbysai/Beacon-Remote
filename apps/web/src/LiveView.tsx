import { talkMids } from "./talk-line";
import { ViewerIcon } from "./viewer-icons";
import { classifyConnectionRoute } from "./connection-route";
import {
  videoPerformance,
  type VideoCounters,
  type VideoPerformance,
} from "./video-performance.js";
import {
  FileSender,
  DownloadResume,
  type Offer,
  type Transfer,
} from "./file-transfer.js";
import { useEffect, useRef, useState } from "react";
import { playForSession } from "./playback.js";
import { viewDeadline } from "./deadline.js";
import { rememberView, forgetView } from "./resume-view.js";
import { peerLifetime } from "./peer-lifetime.js";
import { recoverTransport } from "./recover-transport.js";
import { reconnectUntil } from "./reconnect.js";
import { attachRemoteInput } from "./remote-input.js";
import type { TouchMode } from "./touch-input.js";
import type { DisplayInfo, SessionPermission } from "@beacon-remote/protocol";
import { api } from "./api.js";
import {
  DriveClient,
  driveOps,
  readFile,
  type DriveEntry,
} from "./drive-client.js";
import { lockKeyFor, type LockScreen } from "./lock-screen.js";
import {
  addPermissionLog,
  permissionLogLine,
  type PermissionLogEntry,
} from "./permission-log.js";
import { PrintClient } from "./print-client.js";
import { approvedInput, approvedInputPrefix } from "./approved-input.js";
import {
  permissionNames,
  permissionRequests,
  type PermissionRequestView,
} from "./permission-requests.js";

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
    if (transfer.status === "interrupted")
      return `Download interrupted: ${transfer.name}. Reconnect to resume or discard the partial copy.`;
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

// A short name for a display the computer reported: "Display 2 · 2560×1440", with "main" for the primary one.
export function displayName(display: DisplayInfo): string {
  const number = display.id.replace(/^\\\\\.\\DISPLAY/, "");
  return `Display ${number} · ${display.width}×${display.height}${display.primary ? " · main" : ""}`;
}

const shortLabels: Record<string, string> = {
  "Recent apps": "Recents",
  "Copy from phone": "Copy",
  "Copy from computer": "Copy",
  "Send clipboard to phone": "Paste",
  "Send a file": "Send file",
  "Unlock phone": "Unlock",
  "Talk through phone": "Talk",
  "Stop talking": "Talking",
  "Sound on": "Sound",
  "Sound off": "Sound",
  Record: "Record",
  "Stop recording": "Stop",
  "Full screen": "Full screen",
  "Exit full screen": "Full screen",
};

function RailButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`rail-button${danger ? " danger" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <ViewerIcon name={icon} />
      <span>{shortLabels[label] ?? label}</span>
    </button>
  );
}

export function LiveView({
  grant,
  name,
  onClose,
  displays = [],
  displayId,
  onSwitchDisplay,
  onMinimize,
  minimized = false,
}: {
  grant: ViewGrant;
  name: string;
  onClose: () => void;
  // Hide the viewer and show the device list while the session stays connected.
  onMinimize?: () => void;
  minimized?: boolean;
  // The computer's displays and the one being viewed. Switching asks the computer's person again, because each display
  // is approved on its own; it never widens what was already approved.
  displays?: DisplayInfo[];
  displayId?: string;
  onSwitchDisplay?: (id: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLElement>(null);
  const stop = useRef<() => void>(() => {});
  const play = useRef<() => Promise<void>>(async () => {});
  const permissions = useRef<ReturnType<typeof permissionRequests> | null>(
    null,
  );
  const [permissionView, setPermissionView] = useState<PermissionRequestView>({
    options: [],
    status: "",
    busy: false,
    canCancel: false,
  });
  const [requestedScope, setRequestedScope] = useState<SessionPermission | "">(
    "",
  );
  const selectedScope = permissionView.options.find(
    (scope) => scope === requestedScope,
  );
  const [scale, setScale] = useState<"fit" | "actual">("fit");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  // The person at the computer paused sharing; screen and input are off until they resume.
  const [peerPaused, setPeerPaused] = useState(false);
  const [displayError, setDisplayError] = useState("");
  // The computer is sharing its sound (the person ticked it), and whether this viewer is listening.
  const [hasSound, setHasSound] = useState(false);
  // Talking through the phone's speaker (ADR 0058): the line exists only when the owner allowed it.
  const [talkReady, setTalkReady] = useState(false);
  // Whether the phone is at its lock screen, told by the phone. Unlock is only offered then.
  const [phoneLocked, setPhoneLocked] = useState(false);
  // Instant local feedback: a ripple where the person pressed, drawn at once, before the device has answered.
  const [ripples, setRipples] = useState<
    { id: number; x: number; y: number }[]
  >([]);
  const rippleId = useRef(0);
  const [talkState, setTalkState] = useState<
    "off" | "asking" | "on" | "locked" | "disabled" | "mic"
  >("off");
  const talkSender = useRef<RTCRtpSender | null>(null);
  const talkMic = useRef<MediaStream | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [status, setStatus] = useState(
    grant.source === "desktop"
      ? grant.approval === "policy"
        ? "Connecting…"
        : "Approve this request on the device…"
      : "Waiting for the sharing app…",
  );
  const [frames, setFrames] = useState(0);
  const [ended, setEnded] = useState(false);
  const [controlReady, setControlReady] = useState(false);
  // The computer said it is an Android phone: Back, Home and Recents replace the clipboard button.
  const [phoneHost, setPhoneHost] = useState(false);
  const [touchMode, setTouchMode] = useState<TouchMode>("trackpad");
  const touchModeRef = useRef(touchMode);
  touchModeRef.current = touchMode;
  const controlling = grant.capability === "desktop:control";
  function stopRecording() {
    const active = recorder.current;
    recorder.current = null;
    setRecordingSince(null);
    if (active && active.state !== "inactive") active.stop();
    sender.current?.announceRecording(false);
  }
  function startRecording() {
    const stream = video.current?.srcObject;
    if (!(stream instanceof MediaStream) || recorder.current) return;
    const type = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!type) {
      setDisplayError("This browser cannot record the session.");
      return;
    }
    const chunks: Blob[] = [];
    const active = new MediaRecorder(stream, { mimeType: type });
    active.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    active.onstop = () => {
      if (!chunks.length) return;
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const name = `beacon-session-${stamp}.${type.startsWith("video/mp4") ? "mp4" : "webm"}`;
      link.href = url;
      link.download = name;
      link.click();
      // Kept in this page so it can be played back here; released when replaced or when the page closes.
      if (lastRecordingUrl.current)
        URL.revokeObjectURL(lastRecordingUrl.current);
      lastRecordingUrl.current = url;
      setLastRecording({ url, name });
    };
    // The computer is told first, so it never records unannounced.
    sender.current?.announceRecording(true);
    active.start(1000);
    recorder.current = active;
    setRecordingSince(Date.now());
  }
  async function sendFiles(list: FileList | File[]) {
    const current = sender.current;
    if (!current || sending.current) return;
    sending.current = true;
    try {
      for (const file of Array.from(list)) {
        const status = await current.send(file);
        // Lost with the connection: send it again, from where it stopped, once the channel is back.
        interrupted.current =
          status === "failed" && !current.ready ? file : null;
        if (status !== "done") break;
      }
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
  const interrupted = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileReady, setFileReady] = useState(false);
  // The shared-folder channel (P1-4): exists once the computer opened it; answers only when drive access is granted.
  const drive = useRef<DriveClient | null>(null);
  const [driveReady, setDriveReady] = useState(false);
  const [driveEntries, setDriveEntries] = useState<DriveEntry[] | null>(null);
  const [driveError, setDriveError] = useState("");
  // Printing (P2-1): the computer opens a print channel with each session and answers only while printing is allowed.
  const printer = useRef<PrintClient | null>(null);
  const [printReady, setPrintReady] = useState(false);
  const [printStatus, setPrintStatus] = useState("");
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const downloads = useRef(new DownloadResume());
  // Recording happens in this browser only, and only when the person at the computer allowed it. The computer is
  // told when it starts and stops, and its sharing window says so while it lasts.
  const [recordingAllowed, setRecordingAllowed] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [recordingClock, setRecordingClock] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const sending = useRef(false);
  const [roundTripMillis, setRoundTripMillis] = useState<number | null>(null);
  const [inputRoundTripMillis, setInputRoundTripMillis] = useState<
    number | null
  >(null);
  const [videoStats, setVideoStats] = useState<VideoPerformance>(() =>
    videoPerformance({ id: "", timestamp: 0 }),
  );
  const [lossPct, setLossPct] = useState<number | null>(null);
  const [transportAttempt, setTransportAttempt] = useState(0);
  // Relay credentials are short; each resume brings fresh ones for the next transport.
  const ice = useRef({ id: grant.id, servers: grant.iceServers });
  // A rebuilt transport inherits this: while the computer is away it sends no consent, and a viewer
  // that forgot it was resumable would stop the whole session when the computer came back.
  const wasResumable = useRef("");
  // The device's own clipboard setting, announced when control opens: off, button only (default) or automatic.
  const [clipboardMode, setClipboardMode] = useState<"off" | "button" | "auto">(
    "button",
  );
  const [chatLines, setChatLines] = useState<
    { from: "you" | "phone"; text: string }[]
  >([]);
  const [chatDraft, setChatDraft] = useState("");
  // The phone's PIN screen cannot be captured, so this pad stands in for it. Nothing typed here is kept.
  const [padOpen, setPadOpen] = useState(false);
  const [padNote, setPadNote] = useState("");
  // The most recent recording of this session, played back in the page. Never uploaded.
  const [lastRecording, setLastRecording] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [playback, setPlayback] = useState(false);
  const lastRecordingUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (lastRecordingUrl.current)
        URL.revokeObjectURL(lastRecordingUrl.current);
    },
    [],
  );
  // What the device allowed or refused during this session, newest last. Kept in this page only.
  const [permissionLog, setPermissionLog] = useState<PermissionLogEntry[]>([]);
  // A pattern being chosen (cells 0-8) or a password being typed. Cleared the moment it is sent; never kept.
  const [patternCells, setPatternCells] = useState<number[]>([]);
  const [passwordDraft, setPasswordDraft] = useState("");
  // The layout of the phone's PIN screen, sent by the phone while the pad is open, drawn as a stand-in for the picture.
  const [lockScreen, setLockScreen] = useState<LockScreen | null>(null);
  useEffect(() => {
    const target = video.current;
    if (!target) return;
    const onLayout = (event: Event) =>
      setLockScreen((event as CustomEvent<LockScreen>).detail);
    target.addEventListener("beacon-lockscreen", onLayout);
    return () => target.removeEventListener("beacon-lockscreen", onLayout);
  }, [transportAttempt]);
  useEffect(() => {
    const target = video.current;
    if (!target || !padOpen) return;
    target.dispatchEvent(
      new CustomEvent("beacon-unlock-view", { detail: true }),
    );
    return () => {
      target.dispatchEvent(
        new CustomEvent("beacon-unlock-view", { detail: false }),
      );
      setLockScreen(null);
    };
  }, [padOpen, transportAttempt]);
  useEffect(() => {
    const target = video.current;
    if (!target) return;
    const onUnlock = (event: Event) => {
      const state = String((event as CustomEvent).detail);
      setPadNote(
        state === "ok"
          ? ""
          : state === "not-locked"
            ? "The phone is not locked."
            : state === "off"
              ? "Unlock from the viewer is turned off on the phone."
              : state === "no-pad"
                ? "The phone's keypad did not appear. Try again."
                : "That key could not be pressed.",
      );
    };
    target.addEventListener("beacon-unlock", onUnlock);
    return () => target.removeEventListener("beacon-unlock", onUnlock);
  }, [transportAttempt]);
  useEffect(() => {
    const target = video.current;
    if (!target) return;
    const onChat = (event: Event) =>
      setChatLines((lines) =>
        [
          ...lines,
          {
            from: "phone" as const,
            text: String((event as CustomEvent).detail),
          },
        ].slice(-50),
      );
    target.addEventListener("beacon-chat", onChat);
    return () => target.removeEventListener("beacon-chat", onChat);
  }, [transportAttempt]);
  useEffect(() => {
    const target = video.current;
    if (!target) return;
    const onLock = (event: Event) => {
      const locked = (event as CustomEvent).detail === true;
      setPhoneLocked(locked);
      if (!locked) setPadOpen(false);
    };
    target.addEventListener("beacon-lock", onLock);
    return () => target.removeEventListener("beacon-lock", onLock);
  }, [transportAttempt]);
  const stopMic = () => {
    talkMic.current?.getTracks().forEach((t) => t.stop());
    talkMic.current = null;
    void talkSender.current?.replaceTrack(null).catch(() => undefined);
  };
  useEffect(() => {
    const target = video.current;
    if (!target) return;
    const onTalk = (event: Event) => {
      const state = String((event as CustomEvent).detail);
      if (state === "on") setTalkState("on");
      else {
        stopMic();
        setTalkState(
          state === "locked" || state === "disabled" ? state : "off",
        );
      }
    };
    target.addEventListener("beacon-talk", onTalk);
    return () => {
      target.removeEventListener("beacon-talk", onTalk);
      stopMic();
    };
  }, [transportAttempt]);
  const toggleTalk = async () => {
    if (talkState === "on" || talkState === "asking") {
      stopMic();
      video.current?.dispatchEvent(
        new CustomEvent("beacon-talk-send", { detail: false }),
      );
      setTalkState("off");
      return;
    }
    setTalkState("asking");
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const track = mic.getAudioTracks()[0];
      if (!track || !talkSender.current) throw new Error("No microphone");
      await talkSender.current.replaceTrack(track);
      talkMic.current = mic;
      video.current?.dispatchEvent(
        new CustomEvent("beacon-talk-send", { detail: true }),
      );
    } catch {
      stopMic();
      setTalkState("mic");
    }
  };
  useEffect(() => {
    const target = video.current;
    if (!target) return;
    const onMode = (event: Event) => {
      const mode = (event as CustomEvent).detail;
      if (mode === "off" || mode === "button" || mode === "auto")
        setClipboardMode(mode);
    };
    target.addEventListener("beacon-clipboard-mode", onMode);
    return () => target.removeEventListener("beacon-clipboard-mode", onMode);
  }, [transportAttempt]);
  if (ice.current.id !== grant.id)
    ice.current = { id: grant.id, servers: grant.iceServers };
  // Measured numbers go to the server every 15 s while the picture flows, so a real device and network can be
  // judged from the session history instead of by feel. No media or content is sent.
  const measured = useRef({
    route,
    pictureHeight,
    presentedFps,
    roundTripMillis,
    lossPct,
  });
  measured.current = {
    route,
    pictureHeight,
    presentedFps,
    roundTripMillis,
    lossPct,
  };
  useEffect(() => {
    if (ended) return;
    const timer = setInterval(() => {
      const now = measured.current;
      if (!["Direct", "Relayed"].includes(now.route)) return;
      void fetch(`/api/sessions/${grant.id}/quality`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: now.route,
          height: now.pictureHeight,
          fps: now.presentedFps === null ? null : Math.round(now.presentedFps),
          rttMs:
            now.roundTripMillis === null
              ? null
              : Math.round(now.roundTripMillis),
          lossPct:
            now.lossPct === null ? null : Math.round(now.lossPct * 10) / 10,
        }),
      }).catch(() => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, [grant.id, ended]);
  useEffect(() => {
    if (recordingSince === null) return;
    const timer = setInterval(() => setRecordingClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [recordingSince]);
  // A session that ends stops its recording and saves what was captured.
  useEffect(() => {
    if (ended) stopRecording();
    return () => stopRecording();
  }, [ended]);
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

  const [menuOpen, setMenuOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1200,
  );
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
    setVideoStats(videoPerformance({ id: "", timestamp: 0 }));
    // A reconnect brings a new files channel; the sender belongs to the channel that was lost.
    sender.current = null;
    setFileReady(false);
    setOffer(null);
    if (transportAttempt > 0) setStatus("Reconnecting video…");
    const pc = new RTCPeerConnection({
      iceServers: ice.current.servers,
      iceTransportPolicy: grant.iceTransportPolicy,
      // Keep video and control/files on one transport. Pre-gathering a pool
      // before the host approves can reserve unnecessary bounded TURN slots.
      bundlePolicy: "max-bundle",
      iceCandidatePoolSize: 0,
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
    let resumable = wasResumable.current === grant.id;
    let controlGranted = true;
    let generation = 0;
    let permissionsVersion = 0;
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
      permissions.current = null;
      setRequestedScope("");
      requestedPermissions.reset();
      upgradedInput.dispose();
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
      setHasSound(false);
    }
    function stopRequest() {
      return api(`sessions/${grant.id}/stop`, {}).catch(() => {});
    }
    function finish(reason: string, reloading = false) {
      downloads.current.dispose();
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
                  ? "Connected — click the screen to control it. Escape releases input."
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
    const requestedPermissions = permissionRequests(send, setPermissionView);
    permissions.current = requestedPermissions;
    const upgradedInput = approvedInput(
      (id) => requestedPermissions.hasPendingControl(id),
      (channel, geometry) => attachInput(channel, true, geometry),
    );
    function attachInput(
      channel: RTCDataChannel,
      upgraded = false,
      geometry?: string,
    ) {
      if (!element || inputChannel) {
        channel.close();
        return;
      }
      inputChannel = channel;
      detachInput = attachRemoteInput(
        channel,
        grant.id,
        element,
        (ready) => {
          setControlReady(ready);
          if (!ready) setInputRoundTripMillis(null);
          if (upgraded && ready)
            setStatus(
              "Connected — click the screen to control it. Escape releases input.",
            );
        },
        () => {
          if (!upgraded) {
            finish("Control connection ended. Request control again.");
          } else if (!closed && inputChannel === channel) {
            const dispose = detachInput;
            detachInput = undefined;
            inputChannel = undefined;
            dispose?.();
            channel.close();
            setStatus("Connected — view only. Added control ended.");
          }
        },
        () => touchModeRef.current,
        setDisplayError,
        (platform) => {
          setPhoneHost(platform === "android");
          if (platform === "android") setTouchMode("direct");
        },
        undefined,
        setInputRoundTripMillis,
      );
      if (geometry)
        channel.onmessage?.(new MessageEvent("message", { data: geometry }));
    }
    pc.ondatachannel = (event) => {
      if (event.channel.label.startsWith(approvedInputPrefix)) {
        if (
          permissionsVersion !== 1 ||
          grant.source !== "desktop" ||
          inputChannel ||
          !event.channel.ordered ||
          event.channel.maxRetransmits !== null ||
          event.channel.maxPacketLifeTime !== null
        )
          event.channel.close();
        else upgradedInput.offer(event.channel);
        return;
      }
      if (
        event.channel.label === "beacon-print-v1" &&
        grant.source === "desktop" &&
        !printer.current &&
        event.channel.ordered
      ) {
        const channel = event.channel;
        const client = new PrintClient({
          get open() {
            return channel.readyState === "open";
          },
          send: (text) => channel.send(text),
        });
        printer.current = client;
        channel.onmessage = (message) => client.receive(String(message.data));
        channel.onopen = () => setPrintReady(true);
        channel.onclose = () => {
          client.close();
          printer.current = null;
          setPrintReady(false);
        };
        if (channel.readyState === "open") setPrintReady(true);
        return;
      }
      if (
        event.channel.label === "beacon-drive-v1" &&
        grant.source === "desktop" &&
        !drive.current &&
        event.channel.ordered
      ) {
        const channel = event.channel;
        const client = new DriveClient({
          get open() {
            return channel.readyState === "open";
          },
          send: (text) => channel.send(text),
        });
        drive.current = client;
        channel.onmessage = (message) => client.receive(String(message.data));
        channel.onopen = () => setDriveReady(true);
        channel.onclose = () => {
          client.close();
          drive.current = null;
          setDriveReady(false);
          setDriveEntries(null);
        };
        if (channel.readyState === "open") setDriveReady(true);
        return;
      }
      if (
        event.channel.label === "beacon-files-v1" &&
        grant.source === "desktop" &&
        !sender.current &&
        event.channel.ordered
      ) {
        sender.current = new FileSender(
          event.channel,
          setTransfer,
          (ready) => {
            setFileReady(ready);
            const file = interrupted.current;
            if (ready && file) {
              interrupted.current = null;
              void sendFiles([file]);
            }
          },
          setOffer,
          {
            permissions: (allowed) => setRecordingAllowed(allowed.recording),
            recordingDenied: () => stopRecording(),
            downloads: downloads.current,
          },
        );
        return;
      }
      if (
        !controlling ||
        !controlGranted ||
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
      attachInput(event.channel);
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
              ? "Connected — click the screen to control it. Escape releases input."
              : controlling
                ? "Connected — view only. Control was not allowed on the computer."
                : "Connected — view only."
            : "Connected — synthetic video only.",
        );
      }
    };
    pc.ontrack = (event) => {
      if (!element || closed) return;
      if (event.track.kind === "audio") {
        // Sound the person at the computer agreed to share. It joins the picture's stream and stays muted until
        // the viewer turns it on, because browsers do not allow sound to start by itself.
        const stream =
          element.srcObject instanceof MediaStream
            ? element.srcObject
            : new MediaStream();
        stream.addTrack(event.track);
        element.srcObject = stream;
        setHasSound(true);
        // The phone's sound is part of the session: try to play it right away. The browser allows this after the
        // person's click that opened the session; if it refuses, sound stays off until they press Sound.
        element.muted = false;
        setSoundOn(true);
        void element.play().catch(() => {
          element.muted = true;
          setSoundOn(false);
        });
        return;
      }
      if (event.track.kind !== "video") return;
      // Show each picture the moment it arrives: no extra playout delay, so the screen feels live.
      const receiver = event.receiver as RTCRtpReceiver & {
        jitterBufferTarget?: number | null;
        playoutDelayHint?: number | null;
      };
      try {
        receiver.jitterBufferTarget = 0;
        receiver.playoutDelayHint = 0;
      } catch {
        // Older browsers ignore the hint.
      }
      const stream =
        element.srcObject instanceof MediaStream
          ? element.srcObject
          : new MediaStream();
      stream.addTrack(event.track);
      element.srcObject = stream;
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
              ) {
                generation = message.generation;
                permissionsVersion = message.permissionsVersion === 1 ? 1 : 0;
                requestedPermissions.reset(generation);
              }
              break;
            case "permission-options":
            case "permission-pending":
            case "permission-unavailable":
              requestedPermissions.receive(message);
              break;
            case "permission-result": {
              const result = requestedPermissions.receive(message);
              if (result)
                setPermissionLog((log) =>
                  addPermissionLog(log, {
                    at: Date.now(),
                    scope: result.scope,
                    outcome: result.outcome,
                  }),
                );
              if (result?.scope === "control")
                upgradedInput.result(result.id, result.outcome === "approved");
              break;
            }
            case "consent":
              if (message.accepted !== true)
                finish("Sharing was declined on the device.");
              else {
                if (permissionsVersion === 1)
                  send({ type: "permission-hello" });
                resumable = message.resumable === true;
                wasResumable.current = resumable ? grant.id : "";
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
              // The phone's optional receive-only audio line: ours to send the microphone on.
              const mids = talkMids(message.sdp as string);
              const talk = pc
                .getTransceivers()
                .find(
                  (t) =>
                    t.receiver.track.kind === "audio" &&
                    t.mid !== null &&
                    mids.includes(t.mid),
                );
              if (talk) talk.direction = "sendonly";
              talkSender.current = talk?.sender ?? null;
              setTalkReady(Boolean(talk));
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
              if (message.paused) {
                downloads.current.clear();
                sender.current?.cancel();
                setOffer(null);
              }
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
    let previousVideo: VideoCounters | undefined;
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
            if (report.type === "inbound-rtp" && report.kind === "video") {
              setVideoStats(
                videoPerformance(report as VideoCounters, previousVideo),
              );
              previousVideo = report as VideoCounters;
              const lost = Number(report.packetsLost) || 0;
              const received = Number(report.packetsReceived) || 0;
              if (lost + received > 0)
                setLossPct((lost / (lost + received)) * 100);
            }
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
          setRoute(
            classifyConnectionRoute(
              local,
              remote,
              pc.getConfiguration().iceTransportPolicy,
            ),
          );
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
  const hasNotice =
    ended ||
    peerPaused ||
    frames === 0 ||
    Boolean(permissionView.status) ||
    recordingSince !== null ||
    Boolean(offer) ||
    Boolean(transfer) ||
    Boolean(displayError);
  const sendNav = (action: string) =>
    video.current?.dispatchEvent(
      new CustomEvent("beacon-nav", { detail: action }),
    );
  const toggleFullscreen = async () => {
    try {
      if (isFullscreen) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
      setDisplayError("");
    } catch {
      setDisplayError("Full screen is unavailable in this browser.");
    }
  };
  return (
    <section
      ref={shell}
      className={`live-view${minimized ? " minimized" : ""}`}
      aria-hidden={minimized}
      data-session-id={grant.id}
      data-control={controlReady ? "granted" : "none"}
      data-state={
        ended
          ? "ended"
          : peerPaused
            ? "paused"
            : frames > 0
              ? "viewing"
              : "connecting"
      }
      aria-label={`${name} remote viewer`}
    >
      <header className={`viewer-toolbar${compact ? " compact" : ""}`}>
        {onMinimize && (
          <button
            className="viewer-back"
            title="Back to your devices. The session stays connected."
            onClick={() => {
              setMenuOpen(false);
              onMinimize();
            }}
          >
            <ViewerIcon name="back" />
            <span>Devices</span>
          </button>
        )}
        <div className="viewer-identity">
          <span className="viewer-dot" aria-hidden="true" />
          <div className="viewer-identity-text">
            <strong>{name}</strong>
            <span>
              {ended
                ? "Ended"
                : peerPaused
                  ? "Paused"
                  : frames > 0
                    ? "Connected"
                    : "Connecting"}
              {" · "}
              {grant.source === "desktop"
                ? controlling || controlReady
                  ? "Mouse and keyboard"
                  : "View only"
                : "Video test"}
              {grant.expiresAtMillis === 0 ? " · Until stopped" : ""}
            </span>
          </div>
        </div>
        <div className="viewer-spacer" />
        <button
          className="viewer-menu"
          aria-expanded={menuOpen}
          title={menuOpen ? "Hide the side panel" : "Show the side panel"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <ViewerIcon name="panel" />
          <span>Details</span>
        </button>
        <button
          className="viewer-stop"
          onClick={() => {
            stop.current();
            onClose();
          }}
        >
          {ended ? (
            "Close"
          ) : (
            <>
              <span className="stop-long">End session</span>
              <span className="stop-short">End</span>
            </>
          )}
        </button>
      </header>
      <div className="viewer-status" hidden={!hasNotice}>
        <span role="status" data-decoded-frames={frames}>
          {status}
        </span>
        {!permissionView.canCancel && (
          <span role="status">{permissionView.status}</span>
        )}
        {recordingSince !== null && (
          <span role="status" className="viewer-recording">
            ● Recording{" "}
            {(() => {
              const seconds = Math.max(
                0,
                Math.floor(
                  ((recordingClock || Date.now()) - recordingSince) / 1000,
                ),
              );
              return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
            })()}
          </span>
        )}
        {offer && (
          <span role="status" className="viewer-transfer">
            {phoneHost ? "The phone" : "The computer"} wants to send{" "}
            {offer.name} (
            {(offer.size / 1_048_576).toFixed(offer.size < 10_485_760 ? 1 : 0)}{" "}
            MB).{" "}
            <button
              className="viewer-control"
              onClick={() => sender.current?.accept(offer)}
            >
              {downloads.current.has(offer) ? "Resume download" : "Save"}
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
            {transfer.status === "interrupted" && (
              <button
                className="viewer-control"
                onClick={() => {
                  downloads.current.clear();
                  setTransfer(null);
                }}
              >
                Discard partial copy
              </button>
            )}
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
        {displayError && <span role="alert">{displayError}</span>}
      </div>
      <div className="v-body">
        {!ended && !minimized && frames > 0 && (
          <div
            className="viewer-rail"
            role="toolbar"
            aria-label="Device controls"
          >
            {controlReady && phoneHost && (
              <>
                <RailButton
                  icon="back"
                  label="Back"
                  onClick={() => sendNav("back")}
                />
                <RailButton
                  icon="home"
                  label="Home"
                  onClick={() => sendNav("home")}
                />
                <RailButton
                  icon="recents"
                  label="Recent apps"
                  onClick={() => sendNav("recents")}
                />
                <span className="rail-rule" aria-hidden="true" />
              </>
            )}
            {controlReady && (
              <RailButton
                icon="keyboard"
                label="Keyboard"
                onClick={() =>
                  video.current?.dispatchEvent(new Event("beacon-keyboard"))
                }
              />
            )}
            {controlReady && (
              <RailButton
                icon="copyFrom"
                label={phoneHost ? "Copy from phone" : "Copy from computer"}
                disabled={clipboardMode === "off"}
                onClick={() =>
                  video.current?.dispatchEvent(
                    new Event("beacon-clipboard-read"),
                  )
                }
              />
            )}
            {controlReady && phoneHost && (
              <RailButton
                icon="sendTo"
                label="Send clipboard to phone"
                disabled={clipboardMode === "off"}
                onClick={() =>
                  video.current?.dispatchEvent(
                    new Event("beacon-clipboard-write"),
                  )
                }
              />
            )}
            {fileReady && (
              <RailButton
                icon="file"
                label="Send a file"
                disabled={transfer?.status === "sending"}
                onClick={() => fileInput.current?.click()}
              />
            )}
            {controlReady && phoneHost && (
              <>
                {phoneLocked && (
                  <>
                    <span className="rail-rule" aria-hidden="true" />
                    <RailButton
                      icon="lock"
                      label="Unlock phone"
                      pressed={padOpen}
                      onClick={() => {
                        setPadOpen((open) => !open);
                        setMenuOpen(true);
                      }}
                    />
                  </>
                )}
                {talkReady && (
                  <RailButton
                    icon="mic"
                    label={
                      talkState === "on" ? "Stop talking" : "Talk through phone"
                    }
                    pressed={talkState === "on"}
                    onClick={() => void toggleTalk()}
                  />
                )}
              </>
            )}
            <span className="rail-rule" aria-hidden="true" />
            {hasSound && (
              <RailButton
                icon={soundOn ? "sound" : "mute"}
                label={soundOn ? "Sound on" : "Sound off"}
                pressed={soundOn}
                onClick={() => {
                  const next = !soundOn;
                  if (video.current) video.current.muted = !next;
                  setSoundOn(next);
                }}
              />
            )}
            {recordingAllowed && (
              <RailButton
                icon="record"
                label={recordingSince === null ? "Record" : "Stop recording"}
                pressed={recordingSince !== null}
                danger={recordingSince !== null}
                onClick={() =>
                  recordingSince === null ? startRecording() : stopRecording()
                }
              />
            )}
            <RailButton
              icon="fullscreen"
              label={isFullscreen ? "Exit full screen" : "Full screen"}
              pressed={isFullscreen}
              onClick={() => void toggleFullscreen()}
            />
          </div>
        )}
        <div
          className={`viewer-stage ${scale}`}
          onPointerDown={(event) => {
            if (!controlReady || ended || event.button > 0) return;
            const box = event.currentTarget.getBoundingClientRect();
            const id = ++rippleId.current;
            setRipples((list) => [
              ...list.slice(-4),
              { id, x: event.clientX - box.left, y: event.clientY - box.top },
            ]);
            window.setTimeout(
              () => setRipples((list) => list.filter((r) => r.id !== id)),
              450,
            );
          }}
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
                ? "Remote device video"
                : "Synthetic test video"
            }
          />
          {ripples.map((ripple) => (
            <span
              key={ripple.id}
              className="viewer-ripple"
              style={{ left: ripple.x, top: ripple.y }}
              aria-hidden="true"
            />
          ))}
          {(frames === 0 || ended) && (
            <p className="viewer-placeholder" aria-hidden="true">
              {status}
            </p>
          )}
          {peerPaused && !ended && (
            <p className="viewer-paused" role="status">
              Sharing is paused by the person using this device. Screen and
              input resume when they choose.
            </p>
          )}
          {permissionView.canCancel && !ended && (
            <div className="viewer-sheet" role="status">
              <strong>Waiting for the person to answer</strong>
              <span>{permissionView.status}</span>
              <button
                className="viewer-control"
                onClick={() => permissions.current?.cancel()}
              >
                Cancel access request
              </button>
            </div>
          )}
          {needsPlay && !ended && (
            <button className="viewer-play" onClick={() => void play.current()}>
              Play video
            </button>
          )}
        </div>
        <div className="viewer-actions" id="viewer-panel" hidden={!menuOpen}>
          <div className="v-session" data-g="session">
            <p className="v-session-title">Session</p>
            <dl className="v-stats">
              <div>
                <dt>Route</dt>
                <dd>{route === "Not established" ? "—" : route}</dd>
              </div>
              <div>
                <dt>Picture</dt>
                <dd>{pictureHeight ? `${pictureHeight}p` : "—"}</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>
                  {presentedFps === null
                    ? "—"
                    : `${Math.round(presentedFps)} fps`}
                </dd>
              </div>
              <div>
                <dt>Network RTT</dt>
                <dd>
                  {roundTripMillis === null
                    ? "—"
                    : `${Math.round(roundTripMillis)} ms`}
                </dd>
              </div>
            </dl>
          </div>
          <p className="viewer-group" data-g="view" data-label>
            View
          </p>
          {controlReady && phoneHost && padOpen && (
            <p className="viewer-group" data-g="unlock" data-label>
              Lock screen
            </p>
          )}
          {controlReady && phoneHost && (
            <p className="viewer-group" data-g="chat" data-label>
              Message
            </p>
          )}
          {(driveReady || printReady) && (
            <p className="viewer-group" data-g="files" data-label>
              Files
            </p>
          )}
          {!ended && frames > 0 && permissionView.options.length > 0 && (
            <p className="viewer-group" data-g="access" data-label>
              Access
            </p>
          )}
          <label data-g="view" className="viewer-scale">
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
          {displays.length > 1 && onSwitchDisplay && (
            <label data-g="view" className="viewer-scale">
              Display
              <select
                aria-label="Display"
                value={
                  displayId ??
                  displays.find((entry) => entry.primary)?.id ??
                  displays[0]!.id
                }
                onChange={(event) => onSwitchDisplay(event.target.value)}
              >
                {displays.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {displayName(entry)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hasSound && (
            <button
              data-dup
              data-g="view"
              className="secondary viewer-sound"
              aria-pressed={soundOn}
              title="Hear what is playing on the remote computer"
              onClick={() => {
                const next = !soundOn;
                if (video.current) video.current.muted = !next;
                setSoundOn(next);
              }}
            >
              {soundOn ? "Sound on" : "Sound off"}
            </button>
          )}
          {controlReady && (
            <button
              data-dup
              data-g="nav"
              className="viewer-control"
              title="Open your keyboard to type on the remote computer"
              onClick={() =>
                video.current?.dispatchEvent(new Event("beacon-keyboard"))
              }
            >
              Keyboard
            </button>
          )}
          {!ended && frames > 0 && permissionView.options.length > 0 && (
            <div data-g="access" className="viewer-scale">
              <select
                aria-label="Access to request"
                value={selectedScope ?? ""}
                disabled={permissionView.busy || peerPaused}
                onChange={(event) => {
                  const scope = permissionView.options.find(
                    (option) => option === event.target.value,
                  );
                  setRequestedScope(scope ?? "");
                }}
              >
                <option value="" disabled>
                  Choose access
                </option>
                {permissionView.options.map((scope) => (
                  <option key={scope} value={scope}>
                    {permissionNames[scope]}
                  </option>
                ))}
              </select>
              <button
                className="viewer-control"
                disabled={!selectedScope || permissionView.busy || peerPaused}
                onClick={() => {
                  if (selectedScope)
                    permissions.current?.request(selectedScope);
                  setRequestedScope("");
                }}
              >
                Request access
              </button>
            </div>
          )}
          {controlReady &&
            phoneHost &&
            (
              [
                ["back", "Back", "The phone's Back button"],
                ["home", "Home", "The phone's Home button"],
                ["recents", "Recents", "The phone's recent apps"],
              ] as const
            ).map(([action, label, title]) => (
              <button
                key={action}
                data-g="nav"
                data-dup
                className="viewer-control"
                title={title}
                onClick={() =>
                  video.current?.dispatchEvent(
                    new CustomEvent("beacon-nav", { detail: action }),
                  )
                }
              >
                {label}
              </button>
            ))}
          {driveReady && (
            <button
              data-g="files"
              className="viewer-control"
              title="List the folder the owner shared. Asks for the Shared folder access first."
              onClick={() => {
                setDriveError("");
                drive.current
                  ?.list([])
                  .then((entries) => setDriveEntries(entries))
                  .catch((error: Error) => {
                    setDriveEntries(null);
                    setDriveError(error.message);
                  });
              }}
            >
              Browse shared folder
            </button>
          )}
          {printReady && (
            <button
              data-g="files"
              className="viewer-control"
              title="Send a file to the printer chosen on the computer"
              onClick={() => {
                // The person at the computer chose the printer when they approved; use it, no name to type.
                const client = printer.current;
                if (!client) return;
                setPrintStatus("");
                client
                  .printers()
                  .then((names) => {
                    const name = names[0];
                    if (!name) {
                      setPrintStatus(
                        "No printer was chosen on the computer. Ask for Printing access again.",
                      );
                      return;
                    }
                    const picker = document.createElement("input");
                    picker.type = "file";
                    picker.onchange = () => {
                      const file = picker.files?.[0];
                      if (!file) return;
                      setPrintStatus(`Sending to ${name}…`);
                      file
                        .arrayBuffer()
                        .then((buffer) =>
                          client.printFile(
                            Date.now() % 4_000_000_000,
                            name,
                            new Uint8Array(buffer),
                          ),
                        )
                        .then(() => setPrintStatus(`Printed on ${name}.`))
                        .catch((error: Error) => setPrintStatus(error.message));
                    };
                    picker.click();
                  })
                  .catch((error: Error) => setPrintStatus(error.message));
              }}
            >
              Print a file
            </button>
          )}
          {printStatus && <p role="status">{printStatus}</p>}
          {driveError && <p role="status">{driveError}</p>}
          {driveEntries && (
            <ul data-g="files" aria-label="Shared folder">
              {driveEntries.map((entry) => (
                <li key={entry.name}>
                  {entry.name}
                  {entry.isDir ? "/" : ""}{" "}
                  {!entry.isDir && (
                    <button
                      className="viewer-control"
                      onClick={() => {
                        const client = drive.current;
                        if (!client) return;
                        setDriveError("");
                        readFile(client, [entry.name], entry.size)
                          .then((bytes) => {
                            const url = URL.createObjectURL(
                              new Blob([bytes as Uint8Array<ArrayBuffer>]),
                            );
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = entry.name;
                            link.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          })
                          .catch((error: Error) =>
                            setDriveError(error.message),
                          );
                      }}
                    >
                      Download {entry.name}
                    </button>
                  )}{" "}
                  <button
                    className="viewer-control"
                    onClick={() => {
                      const client = drive.current;
                      if (!client) return;
                      if (
                        !window.confirm(
                          `Delete ${entry.name} from the shared folder? This cannot be undone.`,
                        )
                      )
                        return;
                      setDriveError("");
                      driveOps
                        .remove(client, [entry.name])
                        .then(() => client.list([]))
                        .then((entries) => setDriveEntries(entries))
                        .catch((error: Error) => setDriveError(error.message));
                    }}
                  >
                    Delete {entry.name}
                  </button>
                  <button
                    className="viewer-control"
                    onClick={() => {
                      const client = drive.current;
                      if (!client) return;
                      const to = window
                        .prompt(`Rename ${entry.name} to`, entry.name)
                        ?.trim();
                      if (!to || to === entry.name) return;
                      setDriveError("");
                      driveOps
                        .rename(client, [entry.name], [to])
                        .then(() => client.list([]))
                        .then((entries) => setDriveEntries(entries))
                        .catch((error: Error) => setDriveError(error.message));
                    }}
                  >
                    Rename {entry.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {driveEntries && (
            <button
              data-g="files"
              className="viewer-control"
              onClick={() => {
                const client = drive.current;
                if (!client) return;
                const name = window.prompt("New folder name")?.trim();
                if (!name) return;
                setDriveError("");
                driveOps
                  .mkdir(client, [name])
                  .then(() => client.list([]))
                  .then((entries) => setDriveEntries(entries))
                  .catch((error: Error) => setDriveError(error.message));
              }}
            >
              New folder
            </button>
          )}
          {controlReady && (
            <button
              data-dup
              data-g="clip"
              className="viewer-control"
              disabled={clipboardMode === "off"}
              title={
                clipboardMode === "off"
                  ? "Clipboard sharing is turned off on the device"
                  : phoneHost
                    ? "Copy the phone's clipboard text to this browser"
                    : "Copy the computer's clipboard text to this device"
              }
              onClick={() =>
                video.current?.dispatchEvent(new Event("beacon-clipboard-read"))
              }
            >
              {phoneHost ? "Copy from phone" : "Copy from computer"}
            </button>
          )}
          {controlReady && phoneHost && (
            <button
              data-dup
              data-g="clip"
              className="viewer-control"
              disabled={clipboardMode === "off"}
              title={
                clipboardMode === "off"
                  ? "Clipboard sharing is turned off on the phone"
                  : "Put this browser's clipboard text on the phone's clipboard"
              }
              onClick={() =>
                video.current?.dispatchEvent(
                  new Event("beacon-clipboard-write"),
                )
              }
            >
              Send clipboard to phone
            </button>
          )}
          {controlReady && phoneHost && (
            <button
              data-dup
              data-g="unlock"
              className="viewer-control"
              aria-expanded={padOpen}
              title="Type the phone's passcode here. It is sent to the phone and not saved."
              onClick={() => setPadOpen((open) => !open)}
            >
              Unlock phone
            </button>
          )}
          {controlReady &&
            phoneHost &&
            padOpen &&
            lockScreen?.state === "pad" &&
            lockScreen.lock === "pattern" && (
              <div
                data-g="unlock"
                className="viewer-pattern"
                role="group"
                aria-label="Pattern entry"
              >
                <div className="pattern-grid">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((cell) => (
                    <button
                      key={cell}
                      type="button"
                      className="pattern-dot"
                      aria-label={`Dot ${cell + 1}`}
                      aria-pressed={patternCells.includes(cell)}
                      onClick={() =>
                        setPatternCells((cells) =>
                          cells.includes(cell) ? cells : [...cells, cell],
                        )
                      }
                    >
                      {patternCells.includes(cell)
                        ? patternCells.indexOf(cell) + 1
                        : ""}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="viewer-control"
                  disabled={patternCells.length < 2}
                  onClick={() => {
                    video.current?.dispatchEvent(
                      new CustomEvent("beacon-unlock-pattern", {
                        detail: patternCells,
                      }),
                    );
                    setPatternCells([]);
                  }}
                >
                  Draw pattern
                </button>
                <button
                  type="button"
                  className="viewer-control"
                  onClick={() => setPatternCells([])}
                >
                  Clear
                </button>
                <p className="note" role="status">
                  Click the dots in order, then Draw pattern. It is sent to the
                  phone and not saved.
                </p>
              </div>
            )}
          {controlReady &&
            phoneHost &&
            padOpen &&
            lockScreen?.state === "pad" &&
            lockScreen.lock === "password" && (
              <form
                data-g="unlock"
                className="viewer-password"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!passwordDraft) return;
                  video.current?.dispatchEvent(
                    new CustomEvent("beacon-unlock-password", {
                      detail: passwordDraft,
                    }),
                  );
                  setPasswordDraft("");
                }}
              >
                <input
                  type="password"
                  autoComplete="off"
                  aria-label="Phone password"
                  maxLength={64}
                  value={passwordDraft}
                  onChange={(event) => setPasswordDraft(event.target.value)}
                />
                <button className="viewer-control" type="submit">
                  Send password
                </button>
                <p className="note" role="status">
                  The password is sent to the phone and not saved.
                </p>
              </form>
            )}
          {controlReady &&
            phoneHost &&
            padOpen &&
            lockScreen?.state === "pad" &&
            lockScreen.lock === "pin" && (
              <div
                data-g="unlock"
                className="viewer-replica"
                role="group"
                aria-label="Stand-in for the phone's PIN screen"
                style={{ aspectRatio: `${lockScreen.w} / ${lockScreen.h}` }}
              >
                {lockScreen.nodes.map((node, index) => {
                  const key =
                    node.kind === "key" ? lockKeyFor(node.text) : null;
                  const place = {
                    left: `${(node.x / lockScreen.w) * 100}%`,
                    top: `${(node.y / lockScreen.h) * 100}%`,
                    width: `${(node.w / lockScreen.w) * 100}%`,
                    height: `${(node.h / lockScreen.h) * 100}%`,
                  };
                  const caption = node.text === "Delete" ? "⌫" : node.text;
                  return node.kind === "key" ? (
                    <button
                      key={index}
                      type="button"
                      className="replica-key"
                      style={place}
                      disabled={key === null}
                      aria-label={node.text || "key"}
                      onClick={() =>
                        key &&
                        video.current?.dispatchEvent(
                          new CustomEvent("beacon-unlock-key", { detail: key }),
                        )
                      }
                    >
                      {caption}
                    </button>
                  ) : (
                    <span key={index} className="replica-text" style={place}>
                      {caption}
                    </span>
                  );
                })}
              </div>
            )}
          {controlReady &&
            phoneHost &&
            padOpen &&
            lockScreen !== null &&
            lockScreen.state !== "pad" && (
              <p className="note" role="status">
                {lockScreen.state === "no-pad"
                  ? "Bringing up the PIN screen on the phone…"
                  : lockScreen.state === "not-locked"
                    ? "The phone is not locked."
                    : "Unlock from the viewer is turned off on the phone."}
              </p>
            )}
          {controlReady &&
            phoneHost &&
            padOpen &&
            lockScreen?.state !== "pad" && (
              <div
                data-g="unlock"
                className="viewer-unlock"
                role="group"
                aria-label="Passcode pad"
              >
                {[
                  "1",
                  "2",
                  "3",
                  "4",
                  "5",
                  "6",
                  "7",
                  "8",
                  "9",
                  "delete",
                  "0",
                  "enter",
                ].map((key) => (
                  <button
                    key={key}
                    className="viewer-control"
                    type="button"
                    onClick={() =>
                      video.current?.dispatchEvent(
                        new CustomEvent("beacon-unlock-key", { detail: key }),
                      )
                    }
                  >
                    {key === "delete" ? "⌫" : key === "enter" ? "Enter" : key}
                  </button>
                ))}
                <p className="note" role="status">
                  {padNote ||
                    "Your passcode is sent to the phone as you press. It is not saved."}
                </p>
              </div>
            )}
          {lastRecording && (
            <button
              className="viewer-control"
              aria-expanded={playback}
              onClick={() => setPlayback((open) => !open)}
            >
              {playback ? "Hide recording" : "Play last recording"}
            </button>
          )}
          {lastRecording && playback && (
            <div data-g="view" className="viewer-playback">
              <video controls src={lastRecording.url} />
              <a href={lastRecording.url} download={lastRecording.name}>
                Save again
              </a>
            </div>
          )}
          {permissionLog.length > 0 && (
            <ul
              data-g="access"
              className="viewer-permission-log"
              aria-label="Permissions this session"
            >
              {permissionLog.map((entry, index) => (
                <li key={index}>{permissionLogLine(entry)}</li>
              ))}
            </ul>
          )}
          {controlReady && phoneHost && (
            <form
              data-g="chat"
              className="viewer-chat"
              onSubmit={(event) => {
                event.preventDefault();
                const text = chatDraft.trim().slice(0, 300);
                if (!text) return;
                video.current?.dispatchEvent(
                  new CustomEvent("beacon-chat-send", { detail: text }),
                );
                setChatLines((lines) =>
                  [...lines, { from: "you" as const, text }].slice(-50),
                );
                setChatDraft("");
              }}
            >
              <ul role="log" aria-label="Chat with the phone">
                {chatLines.map((line, index) => (
                  <li key={index}>
                    {line.from === "you" ? "You" : "Phone"}: {line.text}
                  </li>
                ))}
              </ul>
              <input
                aria-label="Message to the phone"
                maxLength={300}
                placeholder="Message to the phone"
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
              />
              <button className="viewer-control" type="submit">
                Send message
              </button>
            </form>
          )}
          {controlReady && phoneHost && talkReady && (
            <button
              data-dup
              data-g="chat"
              className="viewer-control"
              aria-pressed={talkState === "on"}
              title="Talk through the phone's speaker. Only while the phone is unlocked and the owner allowed it."
              onClick={() => void toggleTalk()}
            >
              {talkState === "on"
                ? "Stop talking"
                : talkState === "asking"
                  ? "Starting…"
                  : "Talk through phone"}
            </button>
          )}
          {controlReady && phoneHost && talkReady && talkState !== "off" && (
            <p data-g="chat" className="note" role="status">
              {talkState === "on"
                ? "The phone's speaker is playing your voice. Its notification says someone is talking."
                : talkState === "locked"
                  ? "The phone is locked, so it will not play your voice."
                  : talkState === "disabled"
                    ? "Talking is turned off on the phone."
                    : talkState === "mic"
                      ? "This browser could not use your microphone."
                      : ""}
            </p>
          )}
          {controlReady && phoneHost && clipboardMode === "auto" && (
            <span data-dup data-g="clip" className="viewer-note">
              Clipboard syncs automatically.
            </span>
          )}
          {controlReady && !phoneHost && (
            <button
              data-g="view"
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
            data-dup
            data-g="view"
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
          {recordingAllowed && (
            <button
              data-dup
              data-g="view"
              className="viewer-control"
              title="Record this session in your browser. The person using the device is told while it records."
              onClick={() =>
                recordingSince === null ? startRecording() : stopRecording()
              }
            >
              {recordingSince === null ? "Record" : "Stop recording"}
            </button>
          )}
          {fileReady && (
            <>
              <button
                data-dup
                data-g="files"
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
                Video buffer:{" "}
                {videoStats.jitterBufferMs === null
                  ? "Not measured"
                  : `${videoStats.jitterBufferMs.toFixed(1)} ms`}
              </p>
              <p>
                Control round trip:{" "}
                {inputRoundTripMillis === null
                  ? "Not measured"
                  : `${Math.round(inputRoundTripMillis)} ms`}
              </p>
              <p>
                Decode:{" "}
                {videoStats.decodeMs === null
                  ? "Not measured"
                  : `${videoStats.decodeMs.toFixed(1)} ms`}
              </p>
              <p>
                Receive to decode:{" "}
                {videoStats.receiveToDecodeMs === null
                  ? "Not measured"
                  : `${videoStats.receiveToDecodeMs.toFixed(1)} ms`}
              </p>
              <p>
                Video bitrate:{" "}
                {videoStats.bitrateMbps === null
                  ? "Not measured"
                  : `${videoStats.bitrateMbps.toFixed(2)} Mbps`}
              </p>
              <p>
                Dropped frames in sample:{" "}
                {videoStats.droppedFrames ?? "Not measured"}
              </p>
              <p>
                Video figures describe the latest sample. Receive to decode
                includes buffering and decoding; these times overlap. Network
                RTT is not tap-to-picture latency.
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
                person's response; it does not measure when the approval dialog
                appeared. Presented FPS can drop when this browser tab is
                hidden.
              </p>
              <p>Connection route: {route}</p>
              <p>ICE state: {iceState}</p>
              <p>Browser ICE policy: {policy}</p>
              <p>Selected candidate types: {candidateTypes}</p>
              <p>
                Relay candidates: browser {localRelays}, device {remoteRelays}
              </p>
              {iceError !== null && <p>ICE server error code: {iceError}</p>}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
