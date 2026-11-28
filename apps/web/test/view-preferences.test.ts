import assert from "node:assert/strict";
import test from "node:test";
import {
  readViewPreferences,
  saveViewPreferences,
  zoomStep,
} from "../src/view-preferences.js";

test("view choices are remembered per computer and anything else is ignored", () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
  assert.deepEqual(readViewPreferences("a"), {});
  saveViewPreferences("a", { scale: "actual" });
  saveViewPreferences("a", { touch: "direct" });
  assert.deepEqual(readViewPreferences("a"), {
    scale: "actual",
    touch: "direct",
  });
  assert.deepEqual(readViewPreferences("b"), {});
  store.set(
    "beacon-remote:view:c",
    JSON.stringify({ scale: "huge", touch: "direct", grant: "x" }),
  );
  assert.deepEqual(readViewPreferences("c"), { touch: "direct" });
  saveViewPreferences("e", { scale: "200" });
  assert.deepEqual(readViewPreferences("e"), { scale: "200" });
  store.set("beacon-remote:view:d", "not json");
  assert.deepEqual(readViewPreferences("d"), {});
  assert.deepEqual(readViewPreferences(undefined), {});
});

test("pinch and Ctrl+wheel step through Fit, 100 %, 150 % and 200 % and stop at the ends", () => {
  assert.equal(zoomStep("fit", 1), "actual");
  assert.equal(zoomStep("actual", 1), "150");
  assert.equal(zoomStep("200", 1), "200");
  assert.equal(zoomStep("150", -1), "actual");
  assert.equal(zoomStep("fit", -1), "fit");
});
