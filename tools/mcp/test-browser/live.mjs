// Actual MCP stdio -> React viewer -> synthetic local WebRTC video. No device,
// real account, OS capture/input or assistant-provider upload is involved.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer as reserve } from "node:net";
import { createServer } from "vite";
import { WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";
const root = resolve(import.meta.dirname, "../../..");
if (!process.env.REMOTE_DEV_STATE_DIR)
  throw Error("Enter the Remote workspace first");
const output = join(process.env.REMOTE_DEV_STATE_DIR, "mcp-browser-2026-11-15");
await mkdir(output, { recursive: true });
const machine = randomUUID(),
  id = randomUUID(),
  cookie = "a".repeat(32);
const requests = [],
  signalErrors = [];
let offer,
  host,
  client,
  origin,
  stops = 0;
const ws = new WebSocketServer({ noServer: true });
const vite = await createServer({
  root: join(root, "apps/web"),
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "mcp-local-fixture",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url.startsWith("/api/")) return next();
          const path = req.url.split("?")[0];
          res.setHeader("Content-Type", "application/json");
          if (req.method === "POST") {
            let raw = "";
            req.on("data", (b) => (raw += b));
            req.on("end", () => {
              if (path === `/api/machines/${machine}/sessions`) {
                requests.push(JSON.parse(raw || "{}"));
                res.end(
                  JSON.stringify({
                    id,
                    source: "desktop",
                    capability: "desktop:view",
                    approval: "local",
                    expiresAtMillis: Date.now() + 60_000,
                    reconnectSeconds: 0,
                    iceServers: [],
                    iceTransportPolicy: "all",
                  }),
                );
              } else if (path === `/api/sessions/${id}/stop`) {
                stops++;
                for (const peer of ws.clients)
                  if (peer.readyState === 1) peer.send('{"type":"ended"}');
                res.end('{"ok":true}');
              } else res.end('{"ok":true}');
            });
            return;
          }
          const body = {
            "/api/machines": {
              machines: [
                {
                  id: machine,
                  name: "Synthetic MCP computer",
                  group: null,
                  online: true,
                  lastSeenAt: null,
                  revokedAt: null,
                  accessMode: "attended",
                  allowControl: false,
                  helpersUnattended: "off",
                  displays: [],
                },
              ],
            },
            "/api/media/config": { enabled: true, controlEnabled: false },
            "/api/signup/config": { open: false, emailRecovery: false },
          }[path];
          res.statusCode = body ? 200 : 404;
          res.end(JSON.stringify(body ?? {}));
        });
      },
    },
  ],
});
async function port() {
  const server = reserve();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}
async function wait(predicate) {
  for (let i = 0; i < 80; i++) {
    if (await predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw Error("Synthetic MCP condition timed out");
}
function producer() {
  return (async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const brush = canvas.getContext("2d");
    const draw = () => {
      brush.fillStyle = "#17334c";
      brush.fillRect(0, 0, 640, 360);
      brush.fillStyle = "#fff";
      brush.font = "24px sans-serif";
      brush.fillText("Synthetic MCP viewer", 30, 80);
      brush.font = "16px sans-serif";
      brush.fillText("No desktop capture or OS input", 30, 120);
      brush.fillText(new Date().toISOString(), 30, 160);
    };
    draw();
    window.fixtureDraw = setInterval(draw, 100);
    const peer = (window.fixturePeer = new RTCPeerConnection({
      iceServers: [],
    }));
    peer.addTrack(canvas.captureStream(10).getVideoTracks()[0]);
    // Stands in for the real host's semantic-target channel (ADR 0064): it answers "denied" until the fixture plays the
    // person at the computer and approves, then returns a small tree that includes a password field with no name.
    const treeChannel = peer.createDataChannel("beacon-ui-tree-v1", {
      ordered: true,
    });
    treeChannel.onmessage = (event) => {
      const { id } = JSON.parse(event.data);
      const box = { x: 0, y: 0, width: 100, height: 40 };
      treeChannel.send(
        JSON.stringify(
          window.fixtureApproved
            ? {
                type: "ui-tree",
                id,
                ok: true,
                truncated: false,
                display: { x: 0, y: 0, width: 1280, height: 720 },
                tree: {
                  role: "window",
                  name: "Synthetic settings",
                  states: ["enabled"],
                  bounds: box,
                  children: [
                    {
                      role: "button",
                      name: "Save",
                      states: ["enabled"],
                      bounds: box,
                      children: [],
                    },
                    {
                      role: "password",
                      protected: true,
                      states: ["enabled"],
                      bounds: box,
                      children: [],
                    },
                  ],
                },
              }
            : { type: "ui-tree", id, ok: false, reason: "denied" },
        ),
      );
    };
    const codecs = RTCRtpSender.getCapabilities("video").codecs.filter(
      (c) => c.mimeType.toLowerCase() === "video/h264",
    );
    if (codecs.length) peer.getTransceivers()[0].setCodecPreferences(codecs);
    await peer.setLocalDescription(await peer.createOffer());
    if (peer.iceGatheringState !== "complete")
      await new Promise((done) => {
        peer.addEventListener("icegatheringstatechange", () => {
          if (peer.iceGatheringState === "complete") done();
        });
        setTimeout(done, 2000);
      });
    return peer.localDescription.sdp;
  })();
}
try {
  await vite.listen();
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  host = await openViewer({ origin, cookie, port: await port() });
  await host.goto(`${origin}/#computers`);
  offer = await host.evaluate(`(${producer.toString()})()`);
  vite.httpServer.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith(`/api/sessions/${id}/signal`))
      ws.handleUpgrade(req, socket, head, (peer) =>
        ws.emit("connection", peer),
      );
  });
  ws.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "consent",
        accepted: true,
        control: false,
        resumable: false,
      }),
    );
    socket.send(JSON.stringify({ type: "offer", sdp: offer }));
    let queue = Promise.resolve();
    socket.on("message", (bytes) => {
      const body = JSON.parse(bytes.toString());
      const expression =
        body.type === "answer"
          ? `fixturePeer.setRemoteDescription(${JSON.stringify({ type: "answer", sdp: body.sdp })})`
          : body.type === "candidate"
            ? `fixturePeer.addIceCandidate(${JSON.stringify({ candidate: body.candidate, sdpMid: body.sdpMid, sdpMLineIndex: body.sdpMLineIndex })})`
            : null;
      if (expression)
        queue = queue
          .then(() => host.evaluate(expression))
          .catch((error) => {
            signalErrors.push(error.message);
            socket.close();
          });
    });
  });
  const before = new Set(
    (await readdir(tmpdir())).filter((name) =>
      name.startsWith("beacon-viewer-"),
    ),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "tools/mcp/src/server.mjs")],
    env: {
      ...process.env,
      BEACON_REMOTE_ORIGIN: origin,
      BEACON_REMOTE_COOKIE: cookie,
      BEACON_REMOTE_EMAIL: "",
      BEACON_REMOTE_PASSWORD: "",
      BEACON_REMOTE_MAX_SESSION_SECONDS: "60",
      BEACON_MCP_CONTROL: "enabled",
    },
    stderr: "ignore",
  });
  client = new Client({ name: "synthetic-live-test", version: "0" });
  await client.connect(transport);
  const inventory = await client.callTool({
    name: "list_computers",
    arguments: {},
  });
  assert.equal(JSON.parse(inventory.content[0].text)[0].id, machine);
  const started = await client.callTool({
    name: "request_session",
    arguments: { computer_id: machine, wait_seconds: 15 },
  });
  assert.notEqual(started.isError, true, JSON.stringify(started));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].capability, "desktop:view");
  const duplicate = await client.callTool({
    name: "request_session",
    arguments: { computer_id: machine, wait_seconds: 5 },
  });
  assert.equal(duplicate.isError, true);
  assert.equal(requests.length, 1);
  const shot = await client.callTool({ name: "screenshot", arguments: {} });
  assert.equal(shot.content[0].type, "image");
  const png = Buffer.from(shot.content[0].data, "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await writeFile(join(output, "synthetic-picture.png"), png);
  // Semantic targets: refused until the person at the computer approves, then a numbered tree with no password name.
  const treeArgs = {
    computer_id: machine,
    idempotency_key: "ui-tree-key-0001",
  };
  const waiting = JSON.parse(
    (await client.callTool({ name: "ui_tree", arguments: treeArgs })).content[0]
      .text,
  );
  assert.deepEqual(waiting, { ok: false, reason: "awaiting-owner-approval" });
  await host.evaluate("window.fixtureApproved = true");
  const treeReply = JSON.parse(
    (
      await client.callTool({
        name: "ui_tree",
        arguments: { ...treeArgs, idempotency_key: "ui-tree-key-0002" },
      })
    ).content[0].text,
  );
  assert.equal(treeReply.ok, true, JSON.stringify(treeReply));
  assert.equal(treeReply.nodes.length, 3);
  assert.equal(treeReply.nodes[1].name, "Save");
  assert.equal(treeReply.nodes[2].protected, true);
  assert.equal("name" in treeReply.nodes[2], false);
  assert.equal(treeReply.receipt.tool, "ui_tree");
  for (const peer of ws.clients) peer.send('{"type":"paused","paused":true}');
  await wait(
    async () =>
      JSON.parse(
        (await client.callTool({ name: "session_status", arguments: {} }))
          .content[0].text,
      ).state === "paused",
  );
  assert.equal(
    (await client.callTool({ name: "screenshot", arguments: {} })).isError,
    true,
  );
  const ended = await client.callTool({ name: "end_session", arguments: {} });
  assert.equal(JSON.parse(ended.content[0].text).ended, true);
  assert.ok(stops >= 1);
  assert.equal(
    (await client.callTool({ name: "screenshot", arguments: {} })).isError,
    true,
  );
  const after = (await readdir(tmpdir())).filter(
    (name) => name.startsWith("beacon-viewer-") && !before.has(name),
  );
  assert.deepEqual(after, [], "the owned MCP login profile must be removed");
  assert.deepEqual(signalErrors, []);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        scope:
          "MCP stdio, real React/Chromium/local WebRTC; dummy API and canvas",
        viewOnly: true,
        semanticTree: true,
        screenshot: true,
        pausedPictureRefused: true,
        duplicateRefused: true,
        backendStop: true,
        profileRemoved: true,
      },
      null,
      2,
    ),
  );
  console.log(`Synthetic MCP live-view review passed: ${output}`);
} finally {
  if (client) {
    await client
      .callTool({ name: "end_session", arguments: {} })
      .catch(() => {});
    await client.close();
  }
  for (const peer of ws.clients) peer.terminate();
  await new Promise((done) => ws.close(done));
  await host?.close();
  await vite.close();
}
