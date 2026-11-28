import assert from "node:assert/strict";
import test from "node:test";
import {
  readViewPreferences,
  saveViewPreferences,
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
  store.set("beacon-remote:view:d", "not json");
  assert.deepEqual(readViewPreferences("d"), {});
  assert.deepEqual(readViewPreferences(undefined), {});
});
