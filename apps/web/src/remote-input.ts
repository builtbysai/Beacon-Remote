// Browser events become bounded physical-pixel input, only on an approved channel.
import { isModifierCode, modifierChanges } from "./modifiers.js";
import { pasteSteps, type PasteInput } from "./paste.js";
import { lockScreenShape } from "./lock-screen.js";
import { TouchPad, type TouchAction, type TouchMode } from "./touch-input.js";
import {
  signInInput,
  signInDisplay,
  signInAttentionReply,
  type SignInInputScope,
} from "./signin-input.js";
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

/**
 * Converts one browser wheel delta into Windows wheel units (WHEEL_DELTA = 120 is one notch). A typical
 * mouse notch is 100 CSS pixels in Chrome, so pixel deltas are scaled by 120/100 instead of being sent raw,
 * which under-scrolled ordinary wheels; line and page deltas map to notches directly.
 */
export function wheelUnits(delta: number, deltaMode: number): number {
  const perPixel = 1.2;
  const perLine = 120;
  const perPage = 120 * 24;
  const scale =
    deltaMode === 1 ? perLine : deltaMode === 2 ? perPage : perPixel;
  const units = Math.round(delta * scale);
  return Math.max(-32767, Math.min(32767, units));
}

/** Validates the computer's description of what is being controlled; null if it is not one. */
export function parseDisplay(raw: string): {
  id: string;
  width: number;
  height: number;
  platform?: string;
} | null {
  try {
    const data = JSON.parse(raw);
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
      return null;
    return data;
  } catch {
    return null;
  }
}

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
  onPlatform: (platform: "android" | "desktop") => void = () => undefined,
  signIn?: SignInInputScope,
) {
  let display: { id: string; width: number; height: number } | null = null;
  let sequence = signIn ? 1 : 0,
    disposed = false,
    frame = 0;
  let encoded: { width: number; height: number } | null = null;
  let pending: Record<string, unknown> | null = null;
  let attention: {
    sequence: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let attentionNext = 0;
  let attentionCooldown: ReturnType<typeof setTimeout> | undefined;
  const send = (input: Record<string, unknown>) => {
    if (disposed || channel.readyState !== "open" || !display) return;
    if (signIn && !signIn.live()) {
      onFailure();
      return;
    }
    if (signIn) {
      if (!element.videoWidth || !element.videoHeight) return;
      if (
        !encoded ||
        element.videoWidth !== encoded.width ||
        element.videoHeight !== encoded.height
      ) {
        onFailure();
        return;
      }
    }
    if (channel.bufferedAmount > 16384) {
      onFailure();
      return;
    }
    try {
      const sentSequence = sequence;
      channel.send(
        signIn
          ? signInInput(signIn, sequence++, input)
          : JSON.stringify({
              version: 1,
              sessionId,
              leaseId: sessionId,
              sequence: sequence++,
              input,
            }),
      );
      return sentSequence;
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
  const heldButtons = new Set<number>();
  const synthetic = new Set<number>();
  let composingText = false;
  let pasting: PasteInput[] = [];
  let pasteGeneration = 0;
  const pasteTimer = setInterval(() => {
    const step = pasting.shift();
    if (step) send(step);
  }, 25);
  const paste = async () => {
    if (signIn) {
      onNotice("Clipboard is unavailable during Windows sign-in.");
      return;
    }
    const generation = ++pasteGeneration;
    pasting = [];
    const current = () =>
      generation === pasteGeneration &&
      !disposed &&
      channel.readyState === "open" &&
      !document.hidden;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      if (!current()) return;
      onNotice(
        "Allow clipboard access in your browser to paste to the computer.",
      );
      return;
    }
    // Browser permission UI can outlive focus, Stop or a later paste. Its
    // eventual result must never restart input after that intent was released.
    if (!current()) return;
    const { steps, truncated } = pasteSteps(text);
    if (!steps.length) return;
    if (truncated) onNotice("Only the first 4,000 characters were pasted.");
    pasting = steps;
  };
  const release = () => {
    heldButtons.clear();
    composingText = false;
    pasteGeneration++;
    pasting = [];
    held.clear();
    synthetic.clear();
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
    if (
      send({ type: "button", button: buttons[event.button], down: true }) !==
      undefined
    )
      heldButtons.add(event.button);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !buttons[event.button]) return;
    event.preventDefault();
    move(event);
    flush();
    send({ type: "button", button: buttons[event.button], down: false });
    heldButtons.delete(event.button);
    if (event.buttons === 0 && element.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
  };
  const wheel = (event: WheelEvent) => {
    if (!display || document.activeElement !== element) return;
    event.preventDefault();
    flush();
    send({
      type: "scroll",
      horizontal: wheelUnits(event.deltaX, event.deltaMode),
      vertical: wheelUnits(-event.deltaY, event.deltaMode),
    });
  };
  const key = (event: KeyboardEvent, textMode = false) => {
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      release();
      (event.currentTarget as HTMLElement | null)?.blur();
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
      // A replaced paste may have Enter/Tab held between paced steps. Release
      // those too, so cancelled clipboard UI cannot strand a key or modifier.
      release();
      void paste();
      return;
    }
    const heldCode = scan | (event.code in extended ? 0x100 : 0);
    const sendKey = (code: number, down: boolean) => {
      const input = {
        type: "key" as const,
        scanCode: code & 0xff,
        extended: code > 0xff,
        down,
      };
      // Enter and navigation in the text field must follow queued text.
      if (textMode) pasting.push(input);
      else send(input);
    };
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
      sendKey(heldCode, false);
      for (const code of synthetic) {
        sendKey(code, false);
        held.delete(code);
      }
      synthetic.clear();
      return;
    }
    sendKey(heldCode, event.type === "keydown");
  };
  // The Keyboard action gives local layouts, IMEs and soft keyboards a text
  // field. The video keeps its separate physical scan-code path.
  let sink: HTMLTextAreaElement | null = null;
  const textFocused = () =>
    !disposed &&
    !document.hidden &&
    document.hasFocus() &&
    document.activeElement === sink;
  const typed = (text: string) => {
    if (!textFocused()) return;
    const { steps } = pasteSteps(text);
    pasting.push(...steps);
  };
  const textKey = (event: KeyboardEvent) => {
    if (!textFocused()) return;
    if (event.code === "Escape") {
      key(event);
      return;
    }
    if (
      composingText ||
      event.isComposing ||
      event.key === "Dead" ||
      event.key === "Process"
    )
      return;
    // Modifier flags on a shortcut synthesize the needed remote modifier.
    // Standalone local modifiers belong to the browser's text composition.
    const scan = scans[event.code] ?? extended[event.code];
    if (scan && isModifierCode(scan | (event.code in extended ? 0x100 : 0)))
      return;
    if (
      Array.from(event.key).length === 1 &&
      ((!event.ctrlKey && !event.metaKey && !event.altKey) ||
        event.getModifierState("AltGraph"))
    )
      return;
    key(event, true);
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
      sink.addEventListener("keydown", textKey);
      sink.addEventListener("keyup", textKey);
      sink.addEventListener("compositionstart", () => {
        composingText = textFocused();
      });
      sink.addEventListener("beforeinput", (event) => {
        // Composition (predictive text, IME) is sent once it is committed.
        if (
          event.inputType === "insertText" &&
          event.data &&
          !event.isComposing &&
          !composingText
        ) {
          event.preventDefault();
          typed(event.data);
        }
      });
      sink.addEventListener("compositionend", (event) => {
        const active = composingText;
        composingText = false;
        if (active && event.data) typed(event.data);
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
  // An image follows the text reply, so it is accepted for a while after a request (or any time in Automatic).
  let imageUntil = 0;
  let incomingImage: { mime: string; parts: string[]; length: number } | null =
    null;
  const IMAGE_LIMIT = 1_500_000;
  const requestClipboard = () => {
    if (signIn) return;
    if (!display || awaitingClipboard) return;
    imageUntil = Date.now() + 30_000;
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
      html?: unknown;
      file?: unknown;
    };
    // A reply nobody asked for is accepted only while the phone's own setting is Automatic.
    const asked = awaitingClipboard !== null;
    if (
      (!asked && clipboardMode !== "auto") ||
      reply.type !== "clipboard" ||
      typeof reply.text !== "string" ||
      reply.text.length > 32768 ||
      (reply.html !== undefined &&
        (typeof reply.html !== "string" || reply.html.length > 32768))
    )
      throw new Error();
    if (awaitingClipboard) clearTimeout(awaitingClipboard);
    awaitingClipboard = null;
    if (reply.file === true && !reply.text) {
      // A copied file arrives through the files channel as an offer to save.
      if (asked)
        onNotice("The phone offered the copied file. Use Save to keep it.");
      return;
    }
    if (reply.unavailable === true || !reply.text) {
      if (asked)
        onNotice(
          clipboardMode === "off"
            ? "Clipboard sharing is turned off on the device."
            : "Nothing could be copied. A phone shares its clipboard only while it is unlocked with Beacon in front.",
        );
      return;
    }
    try {
      // Formatted text goes in as formatted text where the browser allows it, with the plain text beside it.
      const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem })
        .ClipboardItem;
      if (typeof reply.html === "string" && reply.html && Item) {
        await navigator.clipboard.write([
          new Item({
            "text/plain": new Blob([reply.text], { type: "text/plain" }),
            "text/html": new Blob([reply.html], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(reply.text);
      }
      // What the browser now holds came from the device; sending it straight back would be a loop.
      lastSentClipboard = reply.text;
      if (asked)
        onNotice(
          reply.truncated
            ? "Copied the start of the computer's clipboard."
            : "Copied from the computer.",
        );
    } catch {
      if (asked)
        onNotice(
          "Allow clipboard access in your browser to copy from the computer.",
        );
    }
  };
  // Send to the device: the browser's clipboard text goes to the device's clipboard, in pieces small enough
  // for the channel. Button: only when pressed. Automatic: also when this page gets focus. Off: never.
  const CLIPBOARD_PIECE = 300;
  const CLIPBOARD_LIMIT = 8000;
  const CLIPBOARD_HTML_LIMIT = 6000;
  let clipboardMode: "off" | "button" | "auto" = "button";
  let lastSentClipboard = "";
  let lastSentImage = "";
  const readClipboardImage = async (): Promise<Blob | null> => {
    try {
      const items = await navigator.clipboard.read?.();
      for (const item of items ?? [])
        if (item.types.includes("image/png"))
          return await item.getType("image/png");
    } catch {
      return null;
    }
    return null;
  };
  const sendClipboardImage = async (image: Blob, explicit: boolean) => {
    if (image.size > IMAGE_LIMIT) {
      if (explicit) onNotice("That image is larger than 1.5 MB.");
      return;
    }
    const bytes = new Uint8Array(await image.arrayBuffer());
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    const encoded = btoa(binary);
    for (let at = 0; at < encoded.length; at += 1000) {
      if (disposed || channel.readyState !== "open") return;
      send({
        type: "clipboard_write",
        kind: "image",
        mime: "image/png",
        text: encoded.slice(at, at + 1000),
        more: at + 1000 < encoded.length,
      });
      // Stay well under the channel's rate limit.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    lastSentImage = `${image.size}`;
    if (explicit) onNotice("Sent the image to the device.");
  };
  const receiveClipboardImage = async (reply: {
    type?: unknown;
    text?: unknown;
    more?: unknown;
    mime?: unknown;
    size?: unknown;
  }) => {
    if (clipboardMode === "off") return;
    if (reply.type === "clipboard_image_start") {
      const size = Number(reply.size);
      if (
        (Date.now() > imageUntil && clipboardMode !== "auto") ||
        typeof reply.mime !== "string" ||
        !/^image\/(png|jpeg|webp|gif)$/.test(reply.mime) ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > IMAGE_LIMIT
      ) {
        incomingImage = null;
        return;
      }
      incomingImage = { mime: reply.mime, parts: [], length: 0 };
      return;
    }
    if (!incomingImage || typeof reply.text !== "string") return;
    incomingImage.length += reply.text.length;
    if (incomingImage.length > 2_100_000) {
      incomingImage = null;
      return;
    }
    incomingImage.parts.push(reply.text);
    if (reply.more === true) return;
    const done = incomingImage;
    incomingImage = null;
    try {
      const binary = atob(done.parts.join(""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++)
        bytes[index] = binary.charCodeAt(index);
      const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem })
        .ClipboardItem;
      if (!Item || done.mime !== "image/png") {
        onNotice("This browser can only copy PNG images.");
        return;
      }
      await navigator.clipboard.write([
        new Item({ "image/png": new Blob([bytes], { type: "image/png" }) }),
      ]);
      lastSentImage = `${bytes.length}`;
      onNotice("Copied the image from the device.");
    } catch {
      onNotice("Allow clipboard access in your browser to copy the image.");
    }
  };
  const pushClipboard = async (explicit: boolean) => {
    if (signIn || !display || disposed) return;
    if (clipboardMode === "off") {
      if (explicit) onNotice("Clipboard sharing is turned off on the device.");
      return;
    }
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      if (explicit)
        onNotice(
          "Allow clipboard access in your browser to send to the device.",
        );
      return;
    }
    if (disposed || channel.readyState !== "open") return;
    const image = await readClipboardImage();
    if (image) {
      if (explicit || `${image.size}` !== lastSentImage)
        await sendClipboardImage(image, explicit);
      return;
    }
    if (!text) {
      if (explicit) onNotice("Your clipboard has no text to send.");
      return;
    }
    if (!explicit && text === lastSentClipboard) return;
    // Formatted text, when the browser has it beside the plain text. Optional and bounded.
    let html = "";
    try {
      const items = await navigator.clipboard.read?.();
      for (const item of items ?? [])
        if (item.types.includes("text/html"))
          html = await (await item.getType("text/html")).text();
    } catch {
      html = "";
    }
    if (disposed || channel.readyState !== "open") return;
    if (html && html.length <= CLIPBOARD_HTML_LIMIT) {
      const parts = Array.from(html).filter((character) => {
        const code = character.codePointAt(0)!;
        return (
          character === "\n" ||
          character === "\t" ||
          (code >= 32 && !(code >= 127 && code <= 159))
        );
      });
      for (let at = 0; at < parts.length; at += CLIPBOARD_PIECE)
        send({
          type: "clipboard_write",
          kind: "html",
          text: parts.slice(at, at + CLIPBOARD_PIECE).join(""),
          more: at + CLIPBOARD_PIECE < parts.length,
        });
    }
    const characters = Array.from(text.replace(/\r\n?/g, "\n")).filter(
      (character) => {
        const code = character.codePointAt(0)!;
        return (
          character === "\n" ||
          character === "\t" ||
          (code >= 32 && !(code >= 127 && code <= 159))
        );
      },
    );
    const sent = characters.slice(0, CLIPBOARD_LIMIT);
    for (let at = 0; at < sent.length; at += CLIPBOARD_PIECE)
      send({
        type: "clipboard_write",
        text: sent.slice(at, at + CLIPBOARD_PIECE).join(""),
        more: at + CLIPBOARD_PIECE < sent.length,
      });
    lastSentClipboard = text;
    if (explicit)
      onNotice(
        characters.length > CLIPBOARD_LIMIT
          ? "Sent the start of your clipboard to the device."
          : "Sent to the device.",
      );
  };
  const pushClipboardByButton = () => void pushClipboard(true);
  const pushClipboardOnFocus = () => {
    if (clipboardMode === "auto" && !document.hidden) void pushClipboard(false);
  };
  window.addEventListener("focus", pushClipboardOnFocus);
  channel.onmessage = (event) => {
    if (signIn) {
      if (
        !disposed &&
        signIn.live() &&
        display &&
        typeof event.data === "string" &&
        attention
      ) {
        const reply = signInAttentionReply(
          event.data,
          signIn,
          attention.sequence,
        );
        if (!reply) {
          onFailure();
          return;
        }
        clearTimeout(attention.timer);
        attention = null;
        attentionNext = performance.now() + 2000;
        attentionCooldown = setTimeout(
          () => signIn.attentionState?.(false),
          2000,
        );
        onNotice(
          reply.status === "requested"
            ? "Ctrl+Alt+Delete requested."
            : reply.status === "policy-unavailable"
              ? "This computer’s Windows policy does not allow remote Ctrl+Alt+Delete."
              : "Ctrl+Alt+Delete is unavailable. Try again.",
        );
        return;
      }
      if (
        disposed ||
        !signIn.live() ||
        display ||
        typeof event.data !== "string"
      ) {
        onFailure();
        return;
      }
      const next = signInDisplay(event.data, signIn);
      if (!next) {
        onFailure();
        return;
      }
      encoded = { width: next.encodedWidth, height: next.encodedHeight };
      display = next;
      onPlatform("desktop");
      onState(true);
      send({ type: "keep_alive" });
      return;
    }
    if (
      display &&
      typeof event.data === "string" &&
      event.data.length <= 120_000
    ) {
      try {
        const reply: unknown = JSON.parse(event.data);
        // Display geometry can change during a live session. Only clipboard
        // replies belong to the pending clipboard request; later display
        // messages must reach the validation and remapping below.
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          reply.type === "clipboard"
        ) {
          void receiveClipboard(reply).catch(onFailure);
          return;
        }
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          (reply.type === "clipboard_image_start" ||
            reply.type === "clipboard_image")
        ) {
          void receiveClipboardImage(reply as Record<string, unknown>).catch(
            onFailure,
          );
          return;
        }
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          reply.type === "lockscreen"
        ) {
          const shape = lockScreenShape(reply);
          if (!shape) {
            onFailure();
            return;
          }
          element.dispatchEvent(
            new CustomEvent("beacon-lockscreen", { detail: shape }),
          );
          return;
        }
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          reply.type === "unlock"
        ) {
          const state = (reply as { state?: unknown }).state;
          if (typeof state !== "string" || state.length > 16) {
            onFailure();
            return;
          }
          element.dispatchEvent(
            new CustomEvent("beacon-unlock", { detail: state }),
          );
          return;
        }
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          reply.type === "lock"
        ) {
          const locked = (reply as { locked?: unknown }).locked;
          if (typeof locked !== "boolean") {
            onFailure();
            return;
          }
          element.dispatchEvent(
            new CustomEvent("beacon-lock", { detail: locked }),
          );
          return;
        }
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          reply.type === "talk"
        ) {
          const state = (reply as { state?: unknown }).state;
          if (typeof state !== "string" || state.length > 16) {
            onFailure();
            return;
          }
          element.dispatchEvent(
            new CustomEvent("beacon-talk", { detail: state }),
          );
          return;
        }
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          reply.type === "chat"
        ) {
          const text = (reply as { text?: unknown }).text;
          if (typeof text !== "string" || text.length > 300) {
            onFailure();
            return;
          }
          element.dispatchEvent(
            new CustomEvent("beacon-chat", { detail: text }),
          );
          return;
        }
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          reply.type === "clipboard_mode"
        ) {
          const mode = (reply as { mode?: unknown }).mode;
          if (mode !== "off" && mode !== "button" && mode !== "auto") {
            onFailure();
            return;
          }
          clipboardMode = mode;
          element.dispatchEvent(
            new CustomEvent("beacon-clipboard-mode", { detail: mode }),
          );
          pushClipboardOnFocus();
          return;
        }
        // A newer phone or computer may say things this page does not know yet. Ignore them instead of ending the
        // session; only a message that is not even shaped like one (below) is a failure.
        if (
          reply !== null &&
          typeof reply === "object" &&
          "type" in reply &&
          typeof reply.type === "string" &&
          reply.type !== "display"
        )
          return;
      } catch {
        onFailure();
        return;
      }
    }
    if (disposed || typeof event.data !== "string" || event.data.length > 512) {
      onFailure();
      return;
    }
    const next = parseDisplay(event.data);
    if (!next) {
      onFailure();
      return;
    }
    // The first message says what is being controlled. A later one (a phone turned sideways, a monitor that changed
    // resolution) replaces its size, so pointer positions keep landing where they should.
    const first = !display;
    display = next;
    if (!first) return;
    onPlatform(next.platform === "android" ? "android" : "desktop");
    // Ask the browser to deliver Alt+Tab, Win and similar keys to the remote computer while it
    // is full screen. Unsupported browsers keep their own shortcuts; Ctrl+Alt+Del cannot be sent.
    void (
      navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }
    ).keyboard
      ?.lock?.()
      .catch(() => undefined);
    onState(true);
    send({ type: "keep_alive" });
    // Only a phone knows this message; it answers with its clipboard setting. A host that never hears
    // it (every older one) stays silent about the clipboard, so older and newer pieces keep working together.
    if (next.platform === "android") send({ type: "clipboard_hello" });
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
    // Releasing capture after a normal mouse-up is expected. Releasing all input
    // there would also release Shift/Ctrl held across clicks and cancel queued touch work.
    if (event.pointerType === "mouse" && heldButtons.size) release();
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
  // A phone's Back, Home and Recents, asked for by the viewer's toolbar.
  const navigate = (event: Event) => {
    const action = (event as CustomEvent<string>).detail;
    if (["back", "home", "recents", "notifications"].includes(action))
      send({ type: "nav", action });
  };
  element.addEventListener("beacon-keyboard", openKeyboard);
  const secureAttention = () => {
    if (!signIn || attention || performance.now() < attentionNext) return;
    release();
    const sequence = send({ type: "secure_attention" });
    if (sequence === undefined) return;
    const timer = setTimeout(() => {
      attention = null;
      signIn.attentionState?.(false);
      onNotice(
        "Ctrl+Alt+Delete could not be confirmed. Check the screen before trying again.",
      );
    }, 6000);
    attention = { sequence, timer };
    signIn.attentionState?.(true);
    onNotice("Requesting Ctrl+Alt+Delete…");
  };
  element.addEventListener("beacon-secure-attention", secureAttention);
  element.addEventListener("beacon-nav", navigate);
  element.addEventListener("beacon-clipboard-read", requestClipboard);
  element.addEventListener("beacon-clipboard-write", pushClipboardByButton);
  // Session chat with a phone: the viewer's line goes to the phone as a notification it can answer.
  const sendChat = (event: Event) => {
    const text = String((event as CustomEvent).detail ?? "")
      .trim()
      .slice(0, 300);
    if (text && display && !signIn) send({ type: "chat", text });
  };
  element.addEventListener("beacon-chat-send", sendChat);
  // Talking through the phone: the viewer asks the phone to unmute its speaker line, or to mute it again.
  const sendTalk = (event: Event) => {
    if (display && !signIn)
      send({ type: "talk", on: (event as CustomEvent).detail === true });
  };
  element.addEventListener("beacon-talk-send", sendTalk);
  // The phone's PIN screen cannot be captured, so the viewer's own number pad sends one key at a time. Keys go
  // straight to the phone: not kept, not logged, not put in any field.
  const sendLockKey = (event: Event) => {
    const key = String((event as CustomEvent).detail ?? "");
    if (display && !signIn && /^([0-9]|delete|enter)$/.test(key))
      send({ type: "unlock_key", key });
  };
  element.addEventListener("beacon-unlock-key", sendLockKey);
  // The viewer's stand-in for the PIN screen asks the phone to send its layout while it is open.
  const lockScreenView = (event: Event) => {
    if (display && !signIn)
      send({ type: "unlock_view", on: (event as CustomEvent).detail === true });
  };
  element.addEventListener("beacon-unlock-view", lockScreenView);
  // A pattern (cells 0-8, top left to bottom right) or a password, typed by the person at the viewer. Sent straight
  // to the phone: not kept, not logged, not put in any field.
  const sendLockPattern = (event: Event) => {
    const cells = (event as CustomEvent).detail as unknown;
    if (
      display &&
      !signIn &&
      Array.isArray(cells) &&
      cells.length >= 2 &&
      cells.length <= 9 &&
      new Set(cells).size === cells.length &&
      cells.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 8)
    )
      send({ type: "unlock_pattern", cells });
  };
  const sendLockPassword = (event: Event) => {
    const text = (event as CustomEvent).detail as unknown;
    if (
      display &&
      !signIn &&
      typeof text === "string" &&
      text.length > 0 &&
      text.length <= 64
    )
      send({ type: "unlock_password", text });
  };
  element.addEventListener("beacon-unlock-pattern", sendLockPattern);
  element.addEventListener("beacon-unlock-password", sendLockPassword);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  const heartbeat = setInterval(() => send({ type: "keep_alive" }), 400);
  return () => {
    release();
    disposed = true;
    if (attention) clearTimeout(attention.timer);
    clearTimeout(attentionCooldown);
    attention = null;
    signIn?.attentionState?.(false);
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
    element.removeEventListener("beacon-secure-attention", secureAttention);
    element.removeEventListener("beacon-nav", navigate);
    element.removeEventListener("beacon-clipboard-read", requestClipboard);
    element.removeEventListener(
      "beacon-clipboard-write",
      pushClipboardByButton,
    );
    window.removeEventListener("focus", pushClipboardOnFocus);
    element.removeEventListener("beacon-chat-send", sendChat);
    element.removeEventListener("beacon-talk-send", sendTalk);
    element.removeEventListener("beacon-unlock-key", sendLockKey);
    element.removeEventListener("beacon-unlock-view", lockScreenView);
    element.removeEventListener("beacon-unlock-pattern", sendLockPattern);
    element.removeEventListener("beacon-unlock-password", sendLockPassword);
    if (awaitingClipboard) clearTimeout(awaitingClipboard);
    sink?.remove();
    sink = null;
    window.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", visibility);
  };
}
