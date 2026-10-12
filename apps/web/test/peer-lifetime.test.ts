import assert from "node:assert/strict";
import { test } from "node:test";
import { peerLifetime } from "../src/peer-lifetime.js";

test("brief ICE loss recovers, while sustained loss and failure terminate", () => {
  let ended = 0;
  let interrupted = 0;
  let callback = () => {};
  let cancelled = false;
  const peer = peerLifetime(
    () => interrupted++,
    () => ended++,
    (run, milliseconds) => {
      assert.equal(milliseconds, 2000);
      callback = run;
      cancelled = false;
      return () => {
        cancelled = true;
      };
    },
  );
  peer.update("disconnected");
  peer.update("disconnected");
  assert.equal(interrupted, 1);
  assert.equal(ended, 0);
  peer.update("connected");
  assert.equal(cancelled, true);
  assert.equal(ended, 0);
  peer.update("disconnected");
  callback();
  assert.equal(ended, 1);
  peer.dispose();
  callback();
  peer.update("failed");
  assert.equal(ended, 1);

  const failed = peerLifetime(
    () => {},
    () => ended++,
  );
  failed.update("failed");
  assert.equal(ended, 2);
  failed.dispose();
});
