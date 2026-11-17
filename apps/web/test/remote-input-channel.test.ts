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
    document: Object.assign(new EventTarget(), { activeElement: video }),
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    },
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  };
  const previous = Object.keys(globals).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const detach = attachRemoteInput(
    channel as unknown as RTCDataChannel,
    "test-session",
    video as unknown as HTMLVideoElement,
    () => {},
    () => {
      failures++;
    },
  );
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
  return { video, sent, copied, message, display, failures: () => failures };
}

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
