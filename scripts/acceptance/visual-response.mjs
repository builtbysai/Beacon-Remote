// Physical-device acceptance only. Reference images remain in the owned browser's
// memory; the caller receives durations and contrast, never screen contents.
export async function createVisualResponseProbe(browser, options) {
  const install = ({
    selector,
    region,
    settleMillis = 1400,
    compareProcessor = false,
  }) => {
    const video = document.querySelector(selector);
    if (!(video instanceof HTMLVideoElement)) throw Error("No live video");
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const capture = (source = video) => {
      const width = source.displayWidth ?? source.videoWidth;
      const height = source.displayHeight ?? source.videoHeight;
      context.drawImage(
        source,
        width * region.x,
        height * region.y,
        width * region.width,
        height * region.height,
        0,
        0,
        64,
        32,
      );
      return context.getImageData(0, 0, 64, 32).data;
    };
    const distance = (a, b) => {
      let sum = 0;
      for (let i = 0; i < a.length; i += 4)
        sum +=
          Math.abs(a[i] - b[i]) +
          Math.abs(a[i + 1] - b[i + 1]) +
          Math.abs(a[i + 2] - b[i + 2]);
      return sum / ((a.length / 4) * 3);
    };
    const settle = () =>
      new Promise((resolve) => setTimeout(resolve, settleMillis));
    const references = new Map();
    let cancel = () => {};
    const probe = {
      response: null,
      async reference(name) {
        await settle();
        references.set(name, capture());
        return true;
      },
      async arm(target) {
        cancel();
        await settle();
        const expected = references.get(target);
        if (!expected) throw Error("Capture the target reference first");
        const baseline = capture(),
          contrast = distance(baseline, expected);
        // Clicking the already selected page is not a latency sample.
        if (contrast < 5)
          throw Error("Target must visibly differ from current page");
        probe.response = new Promise((resolve) => {
          let done = false,
            callback;
          let started,
            processorMs = null,
            processorError = null,
            reader,
            track;
          const recognized = (picture) =>
            distance(picture, baseline) > contrast * 0.35 &&
            distance(picture, expected) < contrast * 0.65;
          const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener("pointerdown", onDown);
            if (callback !== undefined)
              video.cancelVideoFrameCallback(callback);
            void reader?.cancel().catch(() => {});
            track?.stop();
            resolve(
              compareProcessor
                ? { videoMs: value, processorMs, processorError }
                : value,
            );
          };
          const onDown = () => {
            const start = performance.now();
            started = start;
            const tick = () => {
              if (done) return;
              const picture = capture();
              // Lossy encoding can change a few pixels on a still screen. Require
              // a recognizable transition toward the target, not any changed bit.
              if (recognized(picture))
                return finish(Math.round(performance.now() - start));
              callback = video.requestVideoFrameCallback(tick);
            };
            callback = video.requestVideoFrameCallback(tick);
          };
          const timer = setTimeout(() => finish(null), 3500);
          cancel = () => finish(null);
          video.addEventListener("pointerdown", onDown, { once: true });
          if (compareProcessor) {
            void (async () => {
              try {
                // A cloned receiver track shares the approved decoded stream. It
                // introduces no capture, authority, signaling or network changes.
                track = video.srcObject.getVideoTracks()[0].clone();
                reader = new MediaStreamTrackProcessor({
                  track,
                  maxBufferSize: 1,
                }).readable.getReader();
                while (!done) {
                  const { value: frame, done: ended } = await reader.read();
                  if (ended) break;
                  try {
                    if (
                      !done &&
                      started !== undefined &&
                      recognized(capture(frame))
                    ) {
                      processorMs = Math.round(performance.now() - started);
                      break;
                    }
                  } finally {
                    frame.close();
                  }
                }
              } catch (error) {
                processorError = error.name;
              } finally {
                await reader?.cancel().catch(() => {});
                reader?.releaseLock();
                track?.stop();
              }
            })();
          }
        });
        return { contrast };
      },
      dispose() {
        cancel();
        references.clear();
      },
    };
    window.__beaconVisualResponse?.dispose();
    window.__beaconVisualResponse = probe;
    return true;
  };
  await browser.evaluate(`(${install.toString()})(${JSON.stringify(options)})`);
  return {
    reference: (name) =>
      browser.evaluate(
        `window.__beaconVisualResponse.reference(${JSON.stringify(name)})`,
      ),
    arm: async (name) => {
      const result = await browser.evaluate(
        `window.__beaconVisualResponse.arm(${JSON.stringify(name)}).catch(error => ({error: error.message}))`,
      );
      if (result.error) throw Error(`Visual response probe: ${result.error}`);
      return result;
    },
    result: () => browser.evaluate("window.__beaconVisualResponse.response"),
    dispose: () => browser.evaluate("window.__beaconVisualResponse.dispose()"),
  };
}
