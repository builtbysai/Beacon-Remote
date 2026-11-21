import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { attachRemoteInput } from "../src/remote-input.js";

function channelFixture(t: TestContext) {
  const sent: { input: Record<string, unknown> }[] = [];
  const copied: string[] = [];
  let failures = 0;
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    send: (body: string) => sent.push(JSON.parse(body)),
    onmessage: null as ((event: { data: unknown }) => void) | null,
  };
  const video = Object.assign(new EventTarget(), {
    videoWidth: 324,
    videoHeight: 720,
    focus() {},
    blur: () => video.dispatchEvent(new Event("blur")),
    setPointerCapture() {},
    hasPointerCapture: () => true,
    releasePointerCapture() {
      video.dispatchEvent(
        Object.assign(new Event("lostpointercapture"), {
          pointerType: "mouse",
        }),
      );
    },
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: this.videoWidth,
        height: this.videoHeight,
      };
    },
  });
  const globals = {
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), {
      activeElement: video,
      hidden: false,
      hasFocus: () => true,
      createElement: () => sink,
      body: { appendChild() {} },
    }),
    navigator: {
      clipboard: {
        readText: async () => "test paste",
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    },
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  };
  const sink = Object.assign(new EventTarget(), {
    value: "",
    style: {},
    setAttribute() {},
    focus() {
      globals.document.activeElement = sink as unknown as typeof video;
    },
    blur() {
      globals.document.activeElement = video;
      sink.dispatchEvent(new Event("blur"));
    },
    remove() {},
  });
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const dispose = attachRemoteInput(
    channel as unknown as RTCDataChannel,
    "test-session",
    video as unknown as HTMLVideoElement,
    () => {},
    () => {
      failures++;
    },
  );
  let detached = false;
  const detach = () => {
    if (!detached) dispose();
    detached = true;
  };
  t.after(() => {
    detach();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const message = (data: unknown) =>
    channel.onmessage?.({ data: JSON.stringify(data) });
  const display = (width: number, height: number) =>
    message({ type: "display", id: "0", width, height, platform: "android" });
  display(1080, 2400);
  const key = (type: string, code: string, flags = {}) => {
    video.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        code,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        isComposing: false,
        ...flags,
      }),
    );
  };
  return {
    video,
    sent,
    copied,
    message,
    display,
    key,
    detach,
    sink,
    ...globals,
    failures: () => failures,
  };
}

function mouse(video: EventTarget, type: string) {
  video.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), {
      pointerType: "mouse",
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
      buttons: type === "pointerdown" ? 1 : 0,
    }),
  );
}

test("normal mouse-up keeps modifiers held across clicks", (t) => {
  const f = channelFixture(t);
  f.key("keydown", "ShiftLeft", { shiftKey: true });
  mouse(f.video, "pointerdown");
  mouse(f.video, "pointerup");
  assert.equal(
    f.sent.some((message) => message.input.type === "release_all"),
    false,
  );
  f.key("keyup", "ShiftLeft");
  assert.equal(
    f.sent.filter(
      (message) =>
        message.input.type === "key" && message.input.scanCode === 0x2a,
    ).length,
    2,
  );
});

test("unexpected capture loss still releases held mouse and keyboard input", (t) => {
  const f = channelFixture(t);
  f.key("keydown", "ShiftLeft", { shiftKey: true });
  mouse(f.video, "pointerdown");
  f.video.dispatchEvent(
    Object.assign(new Event("lostpointercapture"), { pointerType: "mouse" }),
  );
  assert.equal(f.sent.at(-1)?.input.type, "release_all");
});

test("Keyboard mode emits the local composition once before the next Enter", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = channelFixture(t);
  f.video.dispatchEvent(new Event("beacon-keyboard"));
  const dispatch = (name: string, properties = {}) => {
    const event = Object.assign(
      new Event(name, { cancelable: true }),
      properties,
    );
    f.sink.dispatchEvent(event);
    return event;
  };
  assert.equal(
    dispatch("keydown", { code: "Quote", key: "Dead" }).defaultPrevented,
    false,
  );
  dispatch("compositionstart");
  dispatch("beforeinput", {
    inputType: "insertCompositionText",
    isComposing: true,
    data: "´",
  });
  dispatch("compositionend", { data: "é" });
  dispatch("keydown", { code: "Enter", key: "Enter" });
  dispatch("keyup", { code: "Enter", key: "Enter" });
  const start = f.sent.length;
  for (let i = 0; i < 3; i++) t.mock.timers.tick(25);
  assert.deepEqual(
    f.sent.slice(start).map(({ input }) => input),
    [
      { type: "type_text", text: "é" },
      { type: "key", scanCode: 0x1c, extended: false, down: true },
      { type: "key", scanCode: 0x1c, extended: false, down: false },
    ],
  );
});

test("Keyboard mode uses local AltGraph text and Escape discards a late composition", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = channelFixture(t);
  f.video.dispatchEvent(new Event("beacon-keyboard"));
  const altGraph = Object.assign(new Event("keydown", { cancelable: true }), {
    code: "KeyE",
    key: "€",
    ctrlKey: true,
    altKey: true,
    getModifierState: (key: string) => key === "AltGraph",
  });
  f.sink.dispatchEvent(altGraph);
  assert.equal(altGraph.defaultPrevented, false);
  f.sink.dispatchEvent(
    Object.assign(new Event("beforeinput", { cancelable: true }), {
      inputType: "insertText",
      data: "€",
    }),
  );
  t.mock.timers.tick(25);
  assert.deepEqual(f.sent.at(-1)?.input, { type: "type_text", text: "€" });
  f.sink.dispatchEvent(new Event("compositionstart"));
  f.sink.dispatchEvent(
    Object.assign(new Event("keydown", { cancelable: true }), {
      code: "Escape",
      key: "Escape",
    }),
  );
  assert.equal(f.document.activeElement, f.video);
  const start = f.sent.length;
  f.sink.dispatchEvent(
    Object.assign(new Event("compositionend"), { data: "late text" }),
  );
  t.mock.timers.tick(25);
  assert.deepEqual(f.sent.slice(start), []);
});

test("a second display message keeps the input channel alive and remaps rotated pointer coordinates", async (t) => {
  const f = channelFixture(t);
  f.display(2400, 1080);
  f.video.videoWidth = 720;
  f.video.videoHeight = 324;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.failures(), 0);
  const down = Object.assign(new Event("pointerdown", { cancelable: true }), {
    pointerType: "mouse",
    pointerId: 1,
    button: 0,
    clientX: 360,
    clientY: 162,
  });
  f.video.dispatchEvent(down);
  assert.deepEqual(
    f.sent.filter((body) => body.input.type === "move_pointer").at(-1)?.input,
    {
      type: "move_pointer",
      displayId: "0",
      x: 1200,
      y: 540,
    },
  );
});

test("rotation preserves a pending clipboard reply while unsolicited replies still fail closed", async (t) => {
  const f = channelFixture(t);
  f.video.dispatchEvent(new Event("beacon-clipboard-read"));
  f.display(2400, 1080);
  f.message({ type: "clipboard", text: "test text" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.failures(), 0);
  assert.deepEqual(f.copied, ["test text"]);
  f.message({ type: "clipboard", text: "unsolicited" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.failures(), 1);
  assert.deepEqual(f.copied, ["test text"]);
});

test("focus release clears remembered modifiers before the next shortcut", (t) => {
  const f = channelFixture(t);
  f.key("keydown", "ShiftLeft", { shiftKey: true });
  f.window.dispatchEvent(new Event("blur"));
  const start = f.sent.length;
  // The viewer can regain focus while Shift is still physically held, without
  // receiving another Shift keydown. It must restore it after release_all.
  f.key("keydown", "KeyA", { shiftKey: true });
  f.key("keyup", "KeyA", { shiftKey: true });
  assert.deepEqual(
    f.sent.slice(start).map(({ input }) => input),
    [
      { type: "key", scanCode: 0x2a, extended: false, down: true },
      { type: "key", scanCode: 0x1e, extended: false, down: true },
      { type: "key", scanCode: 0x1e, extended: false, down: false },
      { type: "key", scanCode: 0x2a, extended: false, down: false },
    ],
  );
});

for (const reason of ["blur", "hidden", "escape", "stop"] as const) {
  test(`a delayed clipboard permission result cannot type after ${reason}`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const f = channelFixture(t);
    let resolve!: (text: string) => void;
    f.navigator.clipboard.readText = () =>
      new Promise<string>((done) => {
        resolve = done;
      });
    f.key("keydown", "KeyV", { ctrlKey: true });
    if (reason === "blur") f.window.dispatchEvent(new Event("blur"));
    else if (reason === "hidden") {
      f.document.hidden = true;
      f.document.dispatchEvent(new Event("visibilitychange"));
    } else if (reason === "escape") f.key("keydown", "Escape");
    else f.detach();
    const start = f.sent.length;
    resolve("late clipboard text");
    await new Promise<void>((done) => setImmediate(done));
    t.mock.timers.tick(100);
    assert.deepEqual(f.sent.slice(start), []);
  });
}

test("a newer paste supersedes an older pending clipboard read", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = channelFixture(t);
  const reads: ((text: string) => void)[] = [];
  f.navigator.clipboard.readText = () =>
    new Promise<string>((done) => reads.push(done));
  f.key("keydown", "KeyV", { ctrlKey: true });
  f.key("keydown", "KeyV", { ctrlKey: true });
  reads[1]!("new paste");
  await new Promise<void>((done) => setImmediate(done));
  reads[0]!("old paste");
  await new Promise<void>((done) => setImmediate(done));
  t.mock.timers.tick(25);
  assert.deepEqual(
    f.sent
      .filter(({ input }) => input.type === "type_text")
      .map(({ input }) => input),
    [{ type: "type_text", text: "new paste" }],
  );
});

test("release cancels remaining paced paste steps and a fresh paste still works", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = channelFixture(t);
  f.navigator.clipboard.readText = async () => "\nold text";
  f.key("keydown", "KeyV", { ctrlKey: true });
  await new Promise<void>((done) => setImmediate(done));
  t.mock.timers.tick(25); // Enter is now held; its release is still queued.
  assert.deepEqual(f.sent.at(-1)?.input, {
    type: "key",
    scanCode: 0x1c,
    extended: false,
    down: true,
  });
  f.window.dispatchEvent(new Event("blur"));
  assert.deepEqual(f.sent.at(-1)?.input, { type: "release_all" });
  const start = f.sent.length;
  t.mock.timers.tick(100);
  assert.deepEqual(f.sent.slice(start), []);
  f.navigator.clipboard.readText = async () => "fresh text";
  f.key("keydown", "KeyV", { ctrlKey: true });
  await new Promise<void>((done) => setImmediate(done));
  t.mock.timers.tick(25);
  assert.deepEqual(f.sent.at(-1)?.input, {
    type: "type_text",
    text: "fresh text",
  });
});

test("replacing a paced paste releases its Enter even if the next clipboard read fails", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = channelFixture(t);
  f.navigator.clipboard.readText = async () => "\nold text";
  f.key("keydown", "KeyV", { ctrlKey: true });
  await new Promise<void>((done) => setImmediate(done));
  t.mock.timers.tick(25);
  assert.equal(f.sent.at(-1)?.input.down, true);
  f.navigator.clipboard.readText = async () => {
    throw new Error("permission denied");
  };
  f.key("keydown", "KeyV", { ctrlKey: true });
  assert.deepEqual(f.sent.at(-1)?.input, { type: "release_all" });
  const start = f.sent.length;
  await new Promise<void>((done) => setImmediate(done));
  t.mock.timers.tick(100);
  assert.deepEqual(f.sent.slice(start), []);
});

test("Send to device chunks the viewer's clipboard under the channel's size limit", async (t) => {
  const f = channelFixture(t);
  const text = "é".repeat(700);
  f.navigator.clipboard.readText = async () => text;
  f.video.dispatchEvent(new Event("beacon-clipboard-write"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const writes = f.sent
    .map((body) => body.input)
    .filter((input) => input.type === "clipboard_write");
  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes.map((input) => input.more),
    [true, true, false],
  );
  assert.equal(writes.map((input) => input.text).join(""), text);
});

test("an Off setting on the device stops every clipboard transfer, and Automatic accepts unasked text", async (t) => {
  const f = channelFixture(t);
  f.message({ type: "clipboard_mode", mode: "off" });
  f.video.dispatchEvent(new Event("beacon-clipboard-write"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    f.sent.filter((body) => body.input.type === "clipboard_write").length,
    0,
  );
  f.message({ type: "clipboard_mode", mode: "auto" });
  f.message({ type: "clipboard", text: "from the phone" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(f.copied, ["from the phone"]);
});

test("a phone is greeted once so it can announce its clipboard setting", (t) => {
  const f = channelFixture(t);
  f.display(2400, 1080);
  assert.equal(
    f.sent.filter((body) => body.input.type === "clipboard_hello").length,
    1,
  );
});

test("a message type this page does not know yet is ignored, not fatal", (t) => {
  const f = channelFixture(t);
  f.display(2400, 1080);
  f.message({ type: "something-from-a-newer-phone", detail: 1 });
  assert.equal(f.failures(), 0);
  f.message({ type: 7 });
  assert.equal(f.failures(), 1);
});

test("the phone tells the page when it is locked", (t) => {
  const f = channelFixture(t);
  const states: boolean[] = [];
  f.video.addEventListener("beacon-lock", (event) =>
    states.push((event as CustomEvent).detail === true),
  );
  f.message({ type: "lock", locked: true });
  f.message({ type: "lock", locked: false });
  assert.deepEqual(states, [true, false]);
  assert.equal(f.failures(), 0);
  f.message({ type: "lock", locked: "yes" });
  assert.equal(f.failures(), 1);
});

test("asking to talk goes to the phone and its answer reaches the page", (t) => {
  const f = channelFixture(t);
  const states: string[] = [];
  f.video.addEventListener("beacon-talk", (event) =>
    states.push(String((event as CustomEvent).detail)),
  );
  f.video.dispatchEvent(new CustomEvent("beacon-talk-send", { detail: true }));
  f.video.dispatchEvent(new CustomEvent("beacon-talk-send", { detail: false }));
  assert.deepEqual(
    f.sent.filter((body) => body.input.type === "talk").map((b) => b.input.on),
    [true, false],
  );
  f.message({ type: "talk", state: "locked" });
  f.message({ type: "talk", state: "on" });
  assert.deepEqual(states, ["locked", "on"]);
  assert.equal(f.failures(), 0);
  f.message({ type: "talk", state: "x".repeat(20) });
  assert.equal(f.failures(), 1);
});

test("chat lines go to the phone and the phone's replies reach the page", (t) => {
  const f = channelFixture(t);
  const heard: string[] = [];
  f.video.addEventListener("beacon-chat", (event) =>
    heard.push(String((event as CustomEvent).detail)),
  );
  f.video.dispatchEvent(
    new CustomEvent("beacon-chat-send", { detail: "  hello phone  " }),
  );
  assert.deepEqual(
    f.sent
      .filter((body) => body.input.type === "chat")
      .map((b) => b.input.text),
    ["hello phone"],
  );
  f.message({ type: "chat", text: "hi back" });
  assert.deepEqual(heard, ["hi back"]);
  assert.equal(f.failures(), 0);
  f.message({ type: "chat", text: "x".repeat(301) });
  assert.equal(f.failures(), 1);
});

test("only digits, Delete and Enter are sent as passcode keys, and the phone's answer reaches the page", (t) => {
  const f = channelFixture(t);
  const states: string[] = [];
  f.video.addEventListener("beacon-unlock", (event) =>
    states.push(String((event as CustomEvent).detail)),
  );
  for (const key of ["7", "delete", "enter", "12", "a", "", "<b>"])
    f.video.dispatchEvent(
      new CustomEvent("beacon-unlock-key", { detail: key }),
    );
  assert.deepEqual(
    f.sent
      .filter((body) => body.input.type === "unlock_key")
      .map((body) => body.input.key),
    ["7", "delete", "enter"],
  );
  f.message({ type: "unlock", state: "no-pad" });
  assert.deepEqual(states, ["no-pad"]);
  assert.equal(f.failures(), 0);
});

test("formatted text is sent first and completed by the plain text, and the phone's formatted reply is written as formatted text", async (t) => {
  const f = channelFixture(t);
  const html = "<b>bold</b> text";
  f.navigator.clipboard.readText = async () => "bold text";
  (f.navigator.clipboard as Record<string, unknown>).read = async () => [
    {
      types: ["text/plain", "text/html"],
      getType: async (type: string) =>
        new Blob([type === "text/html" ? html : "bold text"], { type }),
    },
  ];
  f.video.dispatchEvent(new Event("beacon-clipboard-write"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const writes = f.sent
    .map((body) => body.input)
    .filter((input) => input.type === "clipboard_write");
  assert.equal(writes[0]?.kind, "html");
  assert.equal(
    writes
      .filter((input) => input.kind === "html")
      .map((i) => i.text)
      .join(""),
    html,
  );
  const last = writes[writes.length - 1]!;
  assert.equal(last.kind, undefined);
  assert.equal(last.more, false);
  assert.equal(last.text, "bold text");

  const written: Record<string, string>[] = [];
  (globalThis as Record<string, unknown>).ClipboardItem = class {
    constructor(readonly parts: Record<string, Blob>) {}
  };
  (f.navigator.clipboard as Record<string, unknown>).write = async (
    items: { parts: Record<string, Blob> }[],
  ) => {
    for (const item of items) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(item.parts)) out[k] = await v.text();
      written.push(out);
    }
  };
  f.message({ type: "clipboard_mode", mode: "auto" });
  f.message({ type: "clipboard", text: "hi", html: "<i>hi</i>" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(written, [{ "text/plain": "hi", "text/html": "<i>hi</i>" }]);
  delete (globalThis as Record<string, unknown>).ClipboardItem;
});

test("a copied PNG image goes to the phone in paced base64 pieces, and an image from the phone is written to the clipboard", async (t) => {
  const f = channelFixture(t);
  const bytes = new Uint8Array(2500).map((_, index) => index % 251);
  f.navigator.clipboard.readText = async () => "";
  (f.navigator.clipboard as Record<string, unknown>).read = async () => [
    {
      types: ["image/png"],
      getType: async () => new Blob([bytes], { type: "image/png" }),
    },
  ];
  f.video.dispatchEvent(new Event("beacon-clipboard-write"));
  await new Promise((resolve) => setTimeout(resolve, 80));
  const pieces = f.sent
    .map((body) => body.input)
    .filter(
      (input) => input.type === "clipboard_write" && input.kind === "image",
    );
  assert.ok(pieces.length >= 3);
  assert.equal(pieces[pieces.length - 1]?.more, false);
  const joined = pieces.map((input) => String(input.text)).join("");
  assert.deepEqual(
    Array.from(Buffer.from(joined, "base64")),
    Array.from(bytes),
  );

  let written: Blob | undefined;
  (globalThis as Record<string, unknown>).ClipboardItem = class {
    constructor(readonly parts: Record<string, Blob>) {}
  };
  (f.navigator.clipboard as Record<string, unknown>).write = async (
    items: { parts: Record<string, Blob> }[],
  ) => {
    written = items[0]?.parts["image/png"];
  };
  f.message({ type: "clipboard_mode", mode: "auto" });
  f.message({ type: "clipboard_image_start", mime: "image/png", size: 4 });
  f.message({
    type: "clipboard_image",
    text: Buffer.from([1, 2]).toString("base64"),
    more: true,
  });
  f.message({ type: "clipboard_image", text: "", more: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(written);
  delete (globalThis as Record<string, unknown>).ClipboardItem;
});

test("a pattern and a password are sent to the phone only in their exact shapes", (t) => {
  const f = channelFixture(t);
  const pattern = (cells: unknown) =>
    f.video.dispatchEvent(
      new CustomEvent("beacon-unlock-pattern", { detail: cells }),
    );
  pattern([0, 1, 2, 5]);
  pattern([0]);
  pattern([0, 0, 1]);
  pattern([0, 9]);
  pattern("012");
  f.video.dispatchEvent(
    new CustomEvent("beacon-unlock-password", { detail: "hunter2" }),
  );
  f.video.dispatchEvent(
    new CustomEvent("beacon-unlock-password", { detail: "" }),
  );
  f.video.dispatchEvent(
    new CustomEvent("beacon-unlock-password", { detail: "x".repeat(65) }),
  );
  const sent = f.sent.map((body) => body.input);
  assert.deepEqual(
    sent
      .filter((input) => input.type === "unlock_pattern")
      .map((input) => input.cells),
    [[0, 1, 2, 5]],
  );
  assert.deepEqual(
    sent
      .filter((input) => input.type === "unlock_password")
      .map((input) => input.text),
    ["hunter2"],
  );
});
