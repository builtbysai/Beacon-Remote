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
