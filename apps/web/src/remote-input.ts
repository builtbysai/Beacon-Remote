// Browser events become bounded physical-pixel input, only on an approved channel.
import { isModifierCode, modifierChanges } from "./modifiers.js";
import { pasteSteps, type PasteInput } from "./paste.js";
import { TouchPad, type TouchAction, type TouchMode } from "./touch-input.js";
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
scans.IntlBackslash = 0x56;
scans.NumpadEqual = 0x59;
scans.F13 = 0x64;
scans.F14 = 0x65;
scans.F15 = 0x66;
scans.IntlRo = 0x73;
scans.IntlYen = 0x7d;
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
  PrintScreen: 0x37,
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
  touchMode: () => TouchMode = () => "trackpad",
  onNotice: (message: string) => void = () => undefined,
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
  // Ctrl+V types the viewer's clipboard on the computer, paced under the channel's rate limit.
  const held = new Set<number>();
  const synthetic = new Set<number>();
  let pasting: PasteInput[] = [];
  const pasteTimer = setInterval(() => {
    const step = pasting.shift();
    if (step) send(step);
  }, 25);
  const paste = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      onNotice(
        "Allow clipboard access in your browser to paste to the computer.",
      );
      return;
    }
    const { steps, truncated } = pasteSteps(text);
    if (!steps.length) return;
    if (truncated) onNotice("Only the first 4,000 characters were pasted.");
    pasting = steps;
  };
  const release = () => {
    pasting = [];
    touchPad?.release();
    fingers.clear();
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
  let touchPad: TouchPad | null = null;
  const fingers = new Set<number>();
  const apply = (actions: TouchAction[]) => {
    for (const action of actions) {
      if (action.type === "move" && display) {
        pending = {
          type: "move_pointer",
          displayId: display.id,
          x: action.x,
          y: action.y,
        };
        if (!frame) frame = requestAnimationFrame(flush);
      } else {
        flush();
        send(action);
      }
    }
  };
  const touch =
    (kind: "down" | "move" | "up" | "cancel") => (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !display) return;
      if (!touchPad) {
        touchPad = new TouchPad({
          mode: touchMode,
          scale: () => {
            const rect = element.getBoundingClientRect();
            const fit = Math.min(
              rect.width / Math.max(1, element.videoWidth),
              rect.height / Math.max(1, element.videoHeight),
            );
            return fit > 0 && display
              ? display.width / (element.videoWidth * fit)
              : 1;
          },
          locate: (x, y) =>
            display
              ? physicalPoint(
                  x,
                  y,
                  element.getBoundingClientRect(),
                  element.videoWidth,
                  element.videoHeight,
                  display.width,
                  display.height,
                )
              : null,
          start: {
            x: Math.floor(display.width / 2),
            y: Math.floor(display.height / 2),
          },
        });
      }
      event.preventDefault();
      if (kind === "down") {
        element.focus();
        fingers.add(event.pointerId);
      }
      if (kind === "up" || kind === "cancel") fingers.delete(event.pointerId);
      apply(
        touchPad.handle({
          kind,
          id: event.pointerId,
          time: event.timeStamp,
          x: event.clientX,
          y: event.clientY,
        }),
      );
    };
  const touchDown = touch("down");
  const touchMove = touch("move");
  const touchUp = touch("up");
  const touchCancel = touch("cancel");
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
    if (
      event.type === "keydown" &&
      event.code === "KeyV" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      // Lift held modifiers on the computer first, so the typed text is not read as shortcuts.
      for (const code of held)
        send({
          type: "key",
          scanCode: code & 0xff,
          extended: code > 0xff,
          down: false,
        });
      held.clear();
      void paste();
      return;
    }
    const heldCode = scan | (event.code in extended ? 0x100 : 0);
    const sendKey = (code: number, down: boolean) =>
      send({ type: "key", scanCode: code & 0xff, extended: code > 0xff, down });
    if (!isModifierCode(heldCode)) {
      // Line the computer's modifiers up with this event's flags before the key itself.
      for (const change of modifierChanges(held, {
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      })) {
        sendKey(change.code, change.down);
        if (change.down) {
          held.add(change.code);
          synthetic.add(change.code);
        } else held.delete(change.code);
      }
    }
    if (event.type === "keydown") held.add(heldCode);
    else held.delete(heldCode);
    if (event.type === "keyup" && !isModifierCode(heldCode)) {
      // A modifier added only to match this event's flags ends with the key.
      send({
        type: "key",
        scanCode: scan,
        extended: event.code in extended,
        down: false,
      });
      for (const code of synthetic) {
        sendKey(code, false);
        held.delete(code);
      }
      synthetic.clear();
      return;
    }
    send({
      type: "key",
      scanCode: scan,
      extended: event.code in extended,
      down: event.type === "keydown",
    });
  };
  // A phone's soft keyboard sends text, not physical key codes. A hidden field takes its input
  // (a toolbar button asks for it with a "beacon-keyboard" event) and types it as text; keys it does
  // identify (Backspace, Enter, arrows) go through the normal key path.
  let sink: HTMLTextAreaElement | null = null;
  const typed = (text: string) => {
    const { steps } = pasteSteps(text);
    pasting.push(...steps);
  };
  const openKeyboard = () => {
    if (!display) return;
    if (!sink) {
      // A textarea with every helper off, so the phone offers no autofill or suggestions for it.
      sink = document.createElement("textarea");
      sink.setAttribute("aria-label", "Type to the remote computer");
      sink.setAttribute("autocorrect", "off");
      sink.setAttribute("autocomplete", "off");
      sink.setAttribute("data-lpignore", "true");
      sink.rows = 1;
      sink.autocapitalize = "off";
      sink.spellcheck = false;
      sink.style.cssText =
        "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;padding:0";
      sink.addEventListener("keydown", key);
      sink.addEventListener("keyup", key);
      sink.addEventListener("beforeinput", (event) => {
        // Composition (predictive text, IME) is sent once it is committed.
        if (
          event.inputType === "insertText" &&
          event.data &&
          !event.isComposing
        ) {
          event.preventDefault();
          typed(event.data);
        }
      });
      sink.addEventListener("compositionend", (event) => {
        if (event.data) typed(event.data);
        if (sink) sink.value = "";
      });
      sink.addEventListener("blur", release);
      (element.parentElement ?? document.body).appendChild(sink);
    }
    sink.focus();
  };
  const context = (event: Event) => {
    if (display) event.preventDefault();
  };
  const visibility = () => {
    if (document.hidden) release();
  };
  // Copy from the computer: the viewer asks, the computer answers once with its clipboard text, and
  // that text goes to this browser's clipboard. Nothing is sent unasked.
  let awaitingClipboard: ReturnType<typeof setTimeout> | null = null;
  const requestClipboard = () => {
    if (!display || awaitingClipboard) return;
    awaitingClipboard = setTimeout(() => {
      awaitingClipboard = null;
      onNotice("The computer did not answer. Try again.");
    }, 4000);
    send({ type: "clipboard_read" });
  };
  const receiveClipboard = async (data: unknown) => {
    const reply = data as {
      type?: unknown;
      text?: unknown;
      truncated?: unknown;
      unavailable?: unknown;
    };
    if (
      !awaitingClipboard ||
      reply.type !== "clipboard" ||
      typeof reply.text !== "string" ||
      reply.text.length > 32768
    )
      throw new Error();
    clearTimeout(awaitingClipboard);
    awaitingClipboard = null;
    if (reply.unavailable === true || !reply.text) {
      onNotice("The computer's clipboard has no text to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(reply.text);
      onNotice(
        reply.truncated
          ? "Copied the start of the computer's clipboard."
          : "Copied from the computer.",
      );
    } catch {
      onNotice(
        "Allow clipboard access in your browser to copy from the computer.",
      );
    }
  };
  channel.onmessage = (event) => {
    if (
      display &&
      typeof event.data === "string" &&
      event.data.length <= 120_000
    ) {
      try {
        void receiveClipboard(JSON.parse(event.data)).catch(onFailure);
      } catch {
        onFailure();
      }
      return;
    }
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
      // Ask the browser to deliver Alt+Tab, Win and similar keys to the remote computer while it
      // is full screen. Unsupported browsers keep their own shortcuts; Ctrl+Alt+Del cannot be sent.
      void (
        navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }
      ).keyboard
        ?.lock?.()
        .catch(() => undefined);
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
  const pointerMove = (event: PointerEvent) =>
    event.pointerType === "mouse" ? move(event) : touchMove(event);
  const pointerDown = (event: PointerEvent) =>
    event.pointerType === "mouse" ? down(event) : touchDown(event);
  const pointerUp = (event: PointerEvent) =>
    event.pointerType === "mouse" ? up(event) : touchUp(event);
  const pointerCancel = (event: PointerEvent) =>
    event.pointerType === "mouse" ? release() : touchCancel(event);
  // A touch pointer is captured implicitly and "loses" capture on every lift; only a mouse
  // losing capture means the button state is unknown.
  const lostCapture = (event: PointerEvent) => {
    if (event.pointerType === "mouse") release();
  };
  // Held touches become a right-click without waiting for the finger to lift.
  const longPress = setInterval(() => {
    if (touchPad && fingers.size) apply(touchPad.pending(performance.now()));
  }, 100);
  element.addEventListener("pointermove", pointerMove);
  element.addEventListener("pointerdown", pointerDown);
  element.addEventListener("pointerup", pointerUp);
  element.addEventListener("pointercancel", pointerCancel);
  element.addEventListener("lostpointercapture", lostCapture);
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("keydown", key);
  element.addEventListener("keyup", key);
  element.addEventListener("blur", release);
  element.addEventListener("contextmenu", context);
  element.addEventListener("beacon-keyboard", openKeyboard);
  element.addEventListener("beacon-clipboard-read", requestClipboard);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  const heartbeat = setInterval(() => send({ type: "keep_alive" }), 400);
  return () => {
    release();
    disposed = true;
    clearInterval(heartbeat);
    clearInterval(longPress);
    clearInterval(pasteTimer);
    (
      navigator as Navigator & { keyboard?: { unlock?: () => void } }
    ).keyboard?.unlock?.();
    onState(false);
    channel.onmessage = null;
    channel.onclose = null;
    channel.onerror = null;
    element.removeEventListener("pointermove", pointerMove);
    element.removeEventListener("pointerdown", pointerDown);
    element.removeEventListener("pointerup", pointerUp);
    element.removeEventListener("pointercancel", pointerCancel);
    element.removeEventListener("lostpointercapture", lostCapture);
    element.removeEventListener("wheel", wheel);
    element.removeEventListener("keydown", key);
    element.removeEventListener("keyup", key);
    element.removeEventListener("blur", release);
    element.removeEventListener("contextmenu", context);
    element.removeEventListener("beacon-keyboard", openKeyboard);
    element.removeEventListener("beacon-clipboard-read", requestClipboard);
    if (awaitingClipboard) clearTimeout(awaitingClipboard);
    sink?.remove();
    sink = null;
    window.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", visibility);
  };
}
