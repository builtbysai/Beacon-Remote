import assert from "node:assert/strict";
import { test } from "node:test";
import { playForSession } from "../src/playback.js";

test("late playback cannot change an ended or replacement session", async () => {
  for (const rejectPlayback of [false, true]) {
    let settle!: () => void;
    const pending = new Promise<void>((resolve, reject) => {
      settle = () =>
        rejectPlayback ? reject(new Error("browser blocked play")) : resolve();
    });
    let live = true;
    let status = "Connecting";
    let needsPlay = false;
    const result = playForSession(
      () => pending,
      () => live,
      () => {
        status = "Playing";
        needsPlay = false;
      },
      () => {
        status = "Press Play";
        needsPlay = true;
      },
    );
    assert.equal(status, "Connecting");
    assert.equal(needsPlay, false);
    // Stop or grant replacement occurs while the browser's play() is pending.
    live = false;
    status = "Stopped";
    settle();
    await result;
    assert.equal(status, "Stopped");
    assert.equal(needsPlay, false);
  }
});

test("a live blocked stream can be retried; an ended stream cannot play", async () => {
  let live = true;
  let attempts = 0;
  let needsPlay = false;
  const play = async () => {
    if (++attempts === 1) throw new Error("gesture required");
  };
  const request = () =>
    playForSession(
      play,
      () => live,
      () => {
        needsPlay = false;
      },
      () => {
        needsPlay = true;
      },
    );
  await request();
  assert.equal(needsPlay, true);
  await request();
  assert.equal(needsPlay, false);
  live = false;
  await request();
  assert.equal(attempts, 2);
});
