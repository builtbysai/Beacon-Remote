import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { inspectAcceptance } from "./acceptance-readiness.mjs";

test("an available sign-in page cannot hide a stopped or misrouted backend", async () => {
  let readyStatus = 503;
  let machinesStatus = 401;
  const server = createServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(request.url === "/ready" ? readyStatus : machinesStatus);
    response.end("Do not expose response bodies in diagnostics");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await inspectAcceptance(origin)).ready, false);
    readyStatus = 200;
    assert.equal((await inspectAcceptance(origin)).ready, true);
    machinesStatus = 200;
    assert.equal((await inspectAcceptance(origin)).ready, false);
    machinesStatus = 302;
    assert.equal((await inspectAcceptance(origin)).ready, false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const stopped = await inspectAcceptance(origin);
  assert.equal(stopped.ready, false);
  assert.ok(stopped.probes.every(({ status }) => status === null));
});
