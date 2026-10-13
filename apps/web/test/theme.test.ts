import assert from "node:assert/strict";
import { test } from "node:test";
import { readTheme, saveTheme } from "../src/ThemePicker.js";

test("appearance tolerates unavailable storage and discards unsupported saved modes", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Storage blocked by browser policy");
      },
    });
    assert.equal(readTheme(), "system");
    assert.doesNotThrow(() => saveTheme("dark"));

    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    saveTheme("dark");
    assert.equal(readTheme(), "dark");
    saveTheme("system");
    assert.equal(readTheme(), "system");
    values.set("beacon-remote-appearance", "sepia");
    assert.equal(readTheme(), "system");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
