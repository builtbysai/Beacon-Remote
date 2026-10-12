// Browser events become bounded physical-pixel input, only on an approved channel.
const scans: Record<string, number> = {
  Escape: 0x01,
  Backspace: 0x0e,
  Tab: 0x0f,
  Enter: 0x1c,
  ControlLeft: 0x1d,
  ShiftLeft: 0x2a,
  ShiftRight: 0x36,
  AltLeft: 0x38,
  Space: 0x39,
  CapsLock: 0x3a,
  NumLock: 0x45,
  ScrollLock: 0x46,
  Minus: 0x0c,
  Equal: 0x0d,
  BracketLeft: 0x1a,
  BracketRight: 0x1b,
  Semicolon: 0x27,
  Quote: 0x28,
  Backquote: 0x29,
  Backslash: 0x2b,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
  NumpadMultiply: 0x37,
  NumpadSubtract: 0x4a,
  NumpadAdd: 0x4e,
  NumpadDecimal: 0x53,
};
for (const [letters, first] of [
  ["QWERTYUIOP", 0x10],
  ["ASDFGHJKL", 0x1e],
  ["ZXCVBNM", 0x2c],
] as const)
  [...letters].forEach((letter, offset) => {
    scans[`Key${letter}`] = first + offset;
  });
"1234567890".split("").forEach((digit, offset) => {
  scans[`Digit${digit}`] = 2 + offset;
});
for (let n = 1; n <= 10; n++) scans[`F${n}`] = 0x3a + n;
scans.F11 = 0x57;
scans.F12 = 0x58;
const extended: Record<string, number> = {
  ControlRight: 0x1d,
  AltRight: 0x38,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
  Insert: 0x52,
  Delete: 0x53,
  Home: 0x47,
  End: 0x4f,
  PageUp: 0x49,
  PageDown: 0x51,
  ArrowUp: 0x48,
  ArrowDown: 0x50,
  ArrowLeft: 0x4b,
  ArrowRight: 0x4d,
  NumpadEnter: 0x1c,
  NumpadDivide: 0x35,
};
[0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49].forEach(
  (scan, n) => {
    scans[`Numpad${n}`] = scan;
  },
);

export function physicalPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  videoWidth: number,
  videoHeight: number,
  width: number,
  height: number,
) {
  if (
    Math.min(rect.width, rect.height, videoWidth, videoHeight, width, height) <=
    0
  )
    return null;
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const renderedWidth = videoWidth * scale,
    renderedHeight = videoHeight * scale;
  const x = clientX - rect.left - (rect.width - renderedWidth) / 2;
  const y = clientY - rect.top - (rect.height - renderedHeight) / 2;
  if (x < 0 || y < 0 || x >= renderedWidth || y >= renderedHeight) return null;
  // Match the even-pixel NV12 letterbox in the native encoder (pixels.rs).
  const fittedWidth =
    width * videoHeight > height * videoWidth
      ? videoWidth
      : Math.max(2, Math.floor((width * videoHeight) / height)) & ~1;
  const fittedHeight =
    width * videoHeight > height * videoWidth
      ? Math.max(2, Math.floor((height * videoWidth) / width)) & ~1
      : videoHeight;
  const offsetX = Math.floor((videoWidth - fittedWidth) / 2) & ~1;
  const offsetY = Math.floor((videoHeight - fittedHeight) / 2) & ~1;
  const sourceX = x / scale - offsetX;
  const sourceY = y / scale - offsetY;
  if (
    sourceX < 0 ||
    sourceY < 0 ||
    sourceX >= fittedWidth ||
    sourceY >= fittedHeight
  )
    return null;
  return {
    x: Math.min(width - 1, Math.floor((sourceX / fittedWidth) * width)),
    y: Math.min(height - 1, Math.floor((sourceY / fittedHeight) * height)),
  };
}

export function attachRemoteInput(
  channel: RTCDataChannel,
  sessionId: string,
  element: HTMLVideoElement,
  onState: (ready: boolean) => void,
  onFailure: () => void,
) {
  let display: { id: string; width: number; height: number } | null = null;
  let sequence = 0,
    disposed = false,
    frame = 0;
  let pending: Record<string, unknown> | null = null;
  const send = (input: Record<string, unknown>) => {
    if (disposed || channel.readyState !== "open" || !display) return;
    if (channel.bufferedAmount > 16384) {
      onFailure();
      return;
    }
    try {
      channel.send(
        JSON.stringify({
          version: 1,
          sessionId,
          leaseId: sessionId,
          sequence: sequence++,
          input,
        }),
      );
    } catch {
      onFailure();
    }
  };
  const flush = () => {
    if (pending) send(pending);
    pending = null;
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const release = () => {
    pending = null;
    cancelAnimationFrame(frame);
    frame = 0;
    send({ type: "release_all" });
  };
  const move = (event: PointerEvent) => {
    if (!display) return false;
    const point = physicalPoint(
      event.clientX,
      event.clientY,
      element.getBoundingClientRect(),
      element.videoWidth,
      element.videoHeight,
      display.width,
      display.height,
    );
    if (!point) return false;
    pending = { type: "move_pointer", displayId: display.id, ...point };
    if (!frame) frame = requestAnimationFrame(flush);
    return true;
  };
  const buttons = ["left", "middle", "right"];
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !buttons[event.button] || !move(event))
      return;
    event.preventDefault();
    element.focus();
    element.setPointerCapture(event.pointerId);
    flush();
    send({ type: "button", button: buttons[event.button], down: true });
  };
  const up = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !buttons[event.button]) return;
    event.preventDefault();
    move(event);
    flush();
    send({ type: "button", button: buttons[event.button], down: false });
    if (event.buttons === 0 && element.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
  };
  const wheel = (event: WheelEvent) => {
    if (!display || document.activeElement !== element) return;
    event.preventDefault();
    flush();
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
    send({
      type: "scroll",
      horizontal: Math.max(
        -32767,
        Math.min(32767, Math.round(event.deltaX * unit)),
      ),
      vertical: Math.max(
        -32767,
        Math.min(32767, Math.round(-event.deltaY * unit)),
      ),
    });
  };
  const key = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      release();
      element.blur();
      return;
    }
    const scan = scans[event.code] ?? extended[event.code];
    if (!scan || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    flush();
    send({
      type: "key",
      scanCode: scan,
      extended: event.code in extended,
      down: event.type === "keydown",
    });
  };
  const context = (event: Event) => {
    if (display) event.preventDefault();
  };
  const visibility = () => {
    if (document.hidden) release();
  };
  channel.onmessage = (event) => {
    if (
      disposed ||
      typeof event.data !== "string" ||
      event.data.length > 512 ||
      display
    ) {
      onFailure();
      return;
    }
    try {
      const data = JSON.parse(event.data);
      if (
        data.type !== "display" ||
        typeof data.id !== "string" ||
        !data.id.length ||
        data.id.length > 80 ||
        !Number.isInteger(data.width) ||
        !Number.isInteger(data.height) ||
        Math.min(data.width, data.height) < 1 ||
        Math.max(data.width, data.height) > 32768
      )
        throw new Error();
      display = data;
      onState(true);
      send({ type: "keep_alive" });
    } catch {
      onFailure();
    }
  };
  channel.onclose = () => {
    onState(false);
    onFailure();
  };
  channel.onerror = onFailure;
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", release);
  element.addEventListener("lostpointercapture", release);
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("keydown", key);
  element.addEventListener("keyup", key);
  element.addEventListener("blur", release);
  element.addEventListener("contextmenu", context);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  const heartbeat = setInterval(() => send({ type: "keep_alive" }), 400);
  return () => {
    release();
    disposed = true;
    clearInterval(heartbeat);
    onState(false);
    channel.onmessage = null;
    channel.onclose = null;
    channel.onerror = null;
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", release);
    element.removeEventListener("lostpointercapture", release);
    element.removeEventListener("wheel", wheel);
    element.removeEventListener("keydown", key);
    element.removeEventListener("keyup", key);
    element.removeEventListener("blur", release);
    element.removeEventListener("contextmenu", context);
    window.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", visibility);
  };
}
