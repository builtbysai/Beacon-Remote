import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { RemoteSession, checkedOrigin, accountApi } from "../src/session.mjs";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request = { computer_id: id, wait_seconds: 1 };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(over = {}) {
  const calls = { open: 0, close: 0, stops: [] };
  let state = "viewing";
  const viewer = {
    async goto(url) {
      assert.ok(url.endsWith("/#computers"));
    },
    async evaluate(code) {
      if (code.includes("document.getElementById")) return true;
      if (code.includes("toDataURL"))
        return state === "viewing" ? "synthetic-image" : null;
      return { state, picture: true, id, width: 640, height: 360 };
    },
    async clickText() {},
    async close() {
      calls.close++;
    },
  };
  const session = new RemoteSession({
    origin: "https://example.test",
    list: async () => [{ id, name: "Dummy computer", online: true }],
    open: async () => {
      calls.open++;
      return viewer;
    },
    stop: async (value) => calls.stops.push(value),
    pollMs: 1,
    ...over,
  });
  return {
    session,
    viewer,
    calls,
    setState: (value) => {
      state = value;
    },
  };
}
test("a pending inventory reserves the slot before a second request can open a browser", async () => {
  const list = deferred();
  let attempts = 0;
  const f = fixture({
    list: () =>
      ++attempts === 1
        ? list.promise
        : Promise.resolve([{ id, name: "Replacement", online: true }]),
  });
  const first = f.session.request(request);
  assert.equal((await f.session.request(request)).isError, true);
  assert.equal(f.calls.open, 0);
  await f.session.end();
  await f.session.request(request);
  list.resolve([{ id, name: "Dummy", online: true }]);
  assert.equal((await first).isError, true);
  assert.equal(f.calls.open, 1);
  assert.equal(
    JSON.parse((await f.session.status()).content[0].text).open,
    true,
  );
  await f.session.end();
});
test("a viewer created after cancellation is closed without navigating or touching a replacement session", async () => {
  const opening = deferred();
  const f = fixture({ open: () => opening.promise });
  const first = f.session.request(request);
  await new Promise((done) => setImmediate(done));
  const closing = f.session.end();
  assert.equal(
    (await f.session.request(request)).isError,
    true,
    "setup still owns its slot until the late browser is closed",
  );
  opening.resolve(f.viewer);
  await closing;
  assert.equal((await first).isError, true);
  assert.equal(
    JSON.parse((await f.session.status()).content[0].text).open,
    false,
  );
  assert.equal(f.calls.close, 1);
});
test("failed profile cleanup blocks a new session and can be retried", async () => {
  const f = fixture();
  await f.session.request(request);
  let attempts = 0;
  f.viewer.close = async () => {
    if (++attempts === 1) throw Error("locked profile");
  };
  await assert.rejects(f.session.end(), /cleanup/);
  assert.equal((await f.session.request(request)).isError, true);
  assert.equal(
    JSON.parse((await f.session.status()).content[0].text).cleanupPending,
    true,
  );
  assert.equal(await f.session.end(), true);
  assert.equal(
    JSON.parse((await f.session.status()).content[0].text).open,
    false,
  );
});
test("paused/ended pictures and a screenshot completed after Stop never reach the client", async () => {
  const f = fixture();
  await f.session.request(request);
  f.setState("paused");
  assert.equal((await f.session.screenshot()).isError, true);
  f.setState("ended");
  assert.equal((await f.session.screenshot()).isError, true);
  f.setState("viewing");
  const image = deferred();
  const evaluate = f.viewer.evaluate;
  f.viewer.evaluate = (code) =>
    code.includes("toDataURL") ? image.promise : evaluate(code);
  const pending = f.session.screenshot();
  await f.session.end();
  image.resolve("private-stale-image");
  assert.equal((await pending).isError, true);
  assert.deepEqual(f.calls.stops, [id]);
  assert.equal(f.calls.close, 1);
});
test("the hard limit includes setup and cancellation can abort an in-flight request", async () => {
  const list = deferred();
  const f = fixture({ list: () => list.promise, maxMs: 20 });
  const first = f.session.request(request);
  await new Promise((done) => setTimeout(done, 35));
  list.resolve([{ id, online: true }]);
  assert.equal((await first).isError, true);
  assert.equal(f.calls.open, 0);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await f.session.request(request, controller.signal)).isError,
    true,
  );
});
test("origin checks refuse plaintext remote servers, URL credentials and path/query surprises", () => {
  assert.equal(checkedOrigin("https://example.test/"), "https://example.test");
  assert.equal(checkedOrigin("http://127.0.0.1:1234"), "http://127.0.0.1:1234");
  for (const value of [
    "http://example.test",
    "https://user:dummy@example.test",
    "https://example.test/path",
    "https://example.test/?token=dummy",
    "file:///tmp/test",
  ])
    assert.throws(() => checkedOrigin(value));
});
test("sign-in retains MFA and never follows a credential-bearing redirect", async () => {
  let mode = "mfa",
    logins = 0,
    redirects = 0;
  const server = createServer((req, res) => {
    if (req.url === "/elsewhere") {
      redirects++;
      res.end("{}");
      return;
    }
    logins++;
    req.resume();
    if (mode === "redirect") {
      res.writeHead(302, { location: "/elsewhere" });
      res.end();
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end('{"challenge":"synthetic-mfa"}');
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const account = accountApi({
      origin,
      email: "dummy@example.test",
      password: "dummy-test-only",
    });
    await assert.rejects(account.getCookie(), /two-step/);
    await assert.rejects(account.getCookie(), /two-step/);
    assert.equal(logins, 2);
    mode = "redirect";
    await assert.rejects(account.getCookie());
    assert.equal(redirects, 0);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
