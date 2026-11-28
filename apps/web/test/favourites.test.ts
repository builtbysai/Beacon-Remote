import assert from "node:assert/strict";
import test from "node:test";
import {
  favouritesFirst,
  readFavourites,
  toggleFavourite,
} from "../src/favourites.js";

test("starred computers come first and the star toggles", () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
  assert.equal(readFavourites().size, 0);
  assert.ok(toggleFavourite("b").has("b"));
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    favouritesFirst(list, readFavourites()).map((entry) => entry.id),
    ["b", "a", "c"],
  );
  assert.equal(toggleFavourite("b").has("b"), false);
  store.set("beacon-remote:favourites", '{"not":"a list"}');
  assert.equal(readFavourites().size, 0);
});
