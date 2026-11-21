// Physical-device acceptance only. Reference images remain in the owned browser's
// memory; the caller receives durations and contrast, never screen contents.
export async function createVisualResponseProbe(browser, options) {
  const install = ({ selector, region, settleMillis = 1400 }) => {
    const video = document.querySelector(selector);
    if (!(video instanceof HTMLVideoElement)) throw Error("No live video");
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const capture = () => {
      context.drawImage(
        video,
        video.videoWidth * region.x,
        video.videoHeight * region.y,
        video.videoWidth * region.width,
        video.videoHeight * region.height,
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
          const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener("pointerdown", onDown);
            if (callback !== undefined)
              video.cancelVideoFrameCallback(callback);
            resolve(value);
          };
          const onDown = () => {
            const start = performance.now();
            const tick = () => {
              if (done) return;
              const picture = capture();
              // Lossy encoding can change a few pixels on a still screen. Require
              // a recognizable transition toward the target, not any changed bit.
              if (
                distance(picture, baseline) > contrast * 0.35 &&
                distance(picture, expected) < contrast * 0.65
              )
                return finish(Math.round(performance.now() - start));
              callback = video.requestVideoFrameCallback(tick);
            };
            callback = video.requestVideoFrameCallback(tick);
          };
          const timer = setTimeout(() => finish(null), 3500);
          cancel = () => finish(null);
          video.addEventListener("pointerdown", onDown, { once: true });
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
    arm: (name) =>
      browser.evaluate(
        `window.__beaconVisualResponse.arm(${JSON.stringify(name)})`,
      ),
    result: () => browser.evaluate("window.__beaconVisualResponse.response"),
    dispose: () => browser.evaluate("window.__beaconVisualResponse.dispose()"),
  };
}
