// Browser-only development fixture: real React/RTC/canvas, synthetic API and
// input bytes. No accounts, native agent, desktop capture or OS input.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as portServer } from "node:net";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { WebSocketServer } from "ws";
import { openViewer } from "../../../scripts/acceptance/viewer.mjs";

const root = resolve(import.meta.dirname, "../../..");
const output = process.env.REMOTE_DEV_STATE_DIR;
if (!output)
  throw new Error("Enter the Remote workspace before running browser checks.");
const artifacts = join(
  output,
  `signin-browser-${new Date().toISOString().slice(0, 10)}`,
);
await mkdir(artifacts, { recursive: true });
const machine = randomUUID();
let lease = randomUUID(),
  instance = randomUUID();
let context = { leaseId: lease, instanceId: instance, consoleSessionId: 1 };
let desktopId = randomUUID(),
  hostInstance = randomUUID();
let machineOnline = false,
  signInAvailable = true,
  restartRequests = 0,
  signInReservations = 0;
let holdOnRestart = false,
  holdSignIn = false;
const heldReadiness = [];
const desktopGrant = {
  id: desktopId,
  source: "desktop",
  capability: "desktop:control",
  approval: "policy",
  expiresAtMillis: 0,
  reconnectSeconds: 300,
  iceServers: [],
  iceTransportPolicy: "all",
};
let handoffReady = false,
  desktopStops = 0,
  desktopOffer,
  desktopCandidates = [];
const desktopRequests = [];
let stops = 0,
  offer,
  workerCandidates = [],
  browser;
const sockets = new Set();
const signalErrors = [];
const ws = new WebSocketServer({ noServer: true });
const server = await createServer({
  configFile: false,
  optimizeDeps: { force: true },
  root: join(root, "apps/web"),
  server: { host: "127.0.0.1", port: 0, strictPort: true },
  plugins: [
    {
      name: "isolated-signin-fixture",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.url.startsWith("/api/")) {
            next();
            return;
          }
          const path = req.url.split("?")[0];
          if (
            path === `/api/machines/${machine}/signin-authority` &&
            holdSignIn
          ) {
            heldReadiness.push(res);
            return;
          }
          if (
            path === `/api/machines/${machine}/sessions` &&
            req.method === "POST"
          ) {
            let encoded = "";
            req.on("data", (chunk) => {
              encoded += chunk;
            });
            req.on("end", () => {
              desktopRequests.push(JSON.parse(encoded));
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(desktopGrant));
            });
            return;
          }
          let body;
          if (path === "/api/machines")
            body = {
              machines: [
                {
                  id: machine,
                  name: "Sign-in fixture computer",
                  online: machineOnline,
                  hostInstanceId: hostInstance,
                  lastSeenAt: new Date().toISOString(),
                  createdAt: new Date().toISOString(),
                  revokedAt: null,
                  accessMode: "trusted",
                  allowControl: true,
                  bootState: "signed-out",
                  displays: [],
                },
              ],
            };
          else if (path === "/api/media/config")
            body = { enabled: true, controlEnabled: true };
          else if (path === "/api/signup/config")
            body = { open: false, emailRecovery: false };
          else if (path === `/api/machines/${machine}/signin-authority`)
            body = {
              enabled: true,
              state: "sign-in",
              endpointReady: signInAvailable,
              connectable: signInAvailable,
            };
          else if (path === `/api/machines/${machine}/restart`) {
            restartRequests++;
            machineOnline = false;
            signInAvailable = false;
            holdSignIn = holdOnRestart;
            body = { hostInstanceId: hostInstance };
          } else if (path === `/api/machines/${machine}/signin-leases`) {
            signInReservations++;
            body = {
              id: lease,
              scope: "windows:sign-in",
              expiresAtMillis: Date.now() + 15_000,
              connectable: true,
              files: false,
              clipboard: false,
              audio: false,
              recording: false,
              automation: false,
            };
          } else if (path === `/api/signin/leases/${lease}/renew`)
            body = {
              scope: "windows:sign-in",
              expiresAtMillis: Date.now() + 15_000,
            };
          else if (path === `/api/signin/leases/${lease}/handoff`)
            body = handoffReady
              ? {
                  state: "ready",
                  ...context,
                  machineId: machine,
                  hostContext: {
                    instanceId: hostInstance,
                    consoleSessionId: 1,
                  },
                }
              : { state: "pending" };
          else if (path === `/api/sessions/${desktopId}/stop`) {
            desktopStops++;
            body = { ok: true };
          } else if (path === `/api/signin/leases/${lease}/stop`) {
            stops++;
            body = { ok: true };
          } else if (path.endsWith("/activity")) body = { events: [] };
          else {
            res.statusCode = 404;
            body = { error: "No fixture route" };
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        });
      },
    },
  ],
});
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
server.httpServer.on("upgrade", (request, socket, head) => {
  if (
    !request.url.startsWith(`/api/signin/leases/${lease}/signal?role=viewer`) &&
    !request.url.startsWith(`/api/sessions/${desktopId}/signal?role=viewer`)
  )
    return;
  ws.handleUpgrade(request, socket, head, (peer) =>
    ws.emit("connection", peer, request),
  );
});
ws.on("connection", (socket, request) => {
  const ordinary = request.url.startsWith("/api/sessions/");
  socket.fixtureOrdinary = ordinary;
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  if (ordinary)
    socket.send(
      JSON.stringify({
        type: "consent",
        accepted: true,
        control: true,
        resumable: false,
      }),
    );
  else
    socket.send(
      JSON.stringify({
        type: "ready",
        scope: "windows:sign-in",
        ...context,
        workerPublicKey: randomBytes(32).toString("base64"),
        iceServers: [{ urls: ["stun:127.0.0.1:9"] }],
        iceTransportPolicy: "all",
        files: false,
        clipboard: false,
        audio: false,
        recording: false,
        automation: false,
      }),
    );
  if (!ordinary)
    socket.send(
      JSON.stringify({ type: "peer-ready", scope: "windows:sign-in" }),
    );
  socket.send(
    JSON.stringify({ type: "offer", sdp: ordinary ? desktopOffer : offer }),
  );
  for (const candidate of ordinary ? desktopCandidates : workerCandidates)
    socket.send(JSON.stringify({ type: "candidate", ...candidate }));
  let signalQueue = Promise.resolve();
  socket.on("message", (data) => {
    const body = JSON.parse(data.toString());
    const expression =
      body.type === "answer"
        ? `${ordinary ? "fixtureDesktopWorker" : "fixtureWorker"}.setRemoteDescription(${JSON.stringify({ type: "answer", sdp: body.sdp })})`
        : body.type === "candidate"
          ? `${ordinary ? "fixtureDesktopWorker" : "fixtureWorker"}.addIceCandidate(${JSON.stringify({ candidate: body.candidate, sdpMid: body.sdpMid, sdpMLineIndex: body.sdpMLineIndex })})`
          : null;
    if (expression)
      signalQueue = signalQueue
        .then(async () => {
          const result = await browser.command("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (result.result?.exceptionDetails)
            throw new Error(
              result.result.exceptionDetails.exception?.description ??
                "Fixture signaling failed",
            );
        })
        .catch((error) => {
          signalErrors.push(error.message);
          socket.close();
        });
  });
});
async function freePort() {
  const socket = portServer();
  await new Promise((done) => socket.listen(0, "127.0.0.1", done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}
async function waitFor(expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await browser.evaluate(expression)) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  const diagnostic = await browser.evaluate(
    "({status:document.querySelector('.viewer-status')?.textContent,worker:window.fixtureWorker?.connectionState,ice:window.fixtureWorker?.iceConnectionState,inputs:window.fixtureInputs?.length,video:document.querySelector('.signin-view video')?.readyState,events:window.fixturePeerEvents})",
  );
  throw new Error(
    `Browser condition timed out: ${expression}; ${JSON.stringify(diagnostic)}; signaling: ${JSON.stringify(signalErrors)}`,
  );
}
async function producer(binding, ordinary = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const brush = canvas.getContext("2d");
  const draw = () => {
    brush.fillStyle = "#243447";
    brush.fillRect(0, 0, 1280, 720);
    brush.fillStyle = "#eef4fc";
    brush.font = "32px sans-serif";
    brush.fillText(
      ordinary
        ? "Synthetic desktop handoff — no OS control"
        : "Synthetic viewer fixture — no OS control",
      60,
      100,
    );
    brush.font = "20px sans-serif";
    brush.fillText(new Date().toISOString(), 60, 145);
  };
  draw();
  window[ordinary ? "fixtureDesktopDraw" : "fixtureDraw"] = setInterval(
    draw,
    200,
  );
  const worker = new RTCPeerConnection({ iceServers: [] });
  window[ordinary ? "fixtureDesktopWorker" : "fixtureWorker"] = worker;
  window[ordinary ? "fixtureDesktopCandidates" : "fixtureCandidates"] = [];
  window[ordinary ? "fixtureDesktopInputs" : "fixtureInputs"] = [];
  worker.onicecandidate = (event) => {
    if (event.candidate)
      window[ordinary ? "fixtureDesktopCandidates" : "fixtureCandidates"].push(
        event.candidate.toJSON(),
      );
  };
  const track = canvas.captureStream(5).getVideoTracks()[0];
  // Native media supplies fixed-size encoded frames. Chrome's canvas encoder
  // must preserve the declared size too; CPU adaptation otherwise produces a
  // smaller frame that the sign-in input boundary correctly rejects.
  track.contentHint = "detail";
  const sender = worker.addTrack(track, new MediaStream([track]));
  const parameters = sender.getParameters();
  parameters.degradationPreference = "maintain-resolution";
  await sender.setParameters(parameters);
  window[ordinary ? "fixtureDesktopTrack" : "fixtureTrack"] = track;
  const transceiver = worker.getTransceivers()[0];
  transceiver.direction = "sendonly";
  const h264 = RTCRtpSender.getCapabilities("video").codecs.filter(
    (codec) => codec.mimeType.toLowerCase() === "video/h264",
  );
  if (h264.length) transceiver.setCodecPreferences(h264);
  const input = worker.createDataChannel(
    ordinary ? "beacon-input-v1" : "beacon-signin-input-v1",
    {
      ordered: true,
    },
  );
  input.onopen = () =>
    input.send(
      JSON.stringify(
        ordinary
          ? {
              type: "display",
              id: "primary",
              width: 1920,
              height: 1080,
              platform: "desktop",
            }
          : {
              type: "display",
              version: 1,
              scope: "windows:sign-in",
              ...binding,
              id: "signin-primary",
              width: 1920,
              height: 1080,
              encodedWidth: 1280,
              encodedHeight: 720,
              cursorComposited: true,
            },
      ),
    );
  window.fixtureAttentionStatus = "requested";
  input.onmessage = (event) => {
    const frame = JSON.parse(event.data);
    window[ordinary ? "fixtureDesktopInputs" : "fixtureInputs"].push(frame);
    if (!ordinary && frame.input.type === "secure_attention")
      input.send(
        JSON.stringify({
          ...binding,
          type: "secure-attention",
          version: 1,
          scope: "windows:sign-in",
          sequence: frame.sequence,
          status: window.fixtureAttentionStatus,
        }),
      );
  };
  await worker.setLocalDescription(await worker.createOffer());
  return worker.localDescription.sdp;
}
try {
  browser = await openViewer({
    origin,
    cookie: "synthetic-fixture-only",
    port: await freePort(),
  });
  await browser.goto(`${origin}/#computers`);
  await browser.evaluate(`(()=>{
    window.fixturePeerEvents=[];
    const Peer=window.RTCPeerConnection;
    let next=0;
    window.RTCPeerConnection=class extends Peer {
      constructor(config){super(config);const id=++next;
        for(const event of ['connectionstatechange','iceconnectionstatechange','signalingstatechange'])
          this.addEventListener(event,()=>fixturePeerEvents.push({id,event,state:this.connectionState,ice:this.iceConnectionState,signal:this.signalingState}));
      }
      close(){const video=document.querySelector('.signin-view video');fixturePeerEvents.push({event:'close',width:video?.videoWidth,height:video?.videoHeight,stack:new Error().stack});super.close();}
    };
  })()`);
  offer = await browser.evaluate(
    `(${producer.toString()})(${JSON.stringify(context)})`,
  );
  await waitFor("fixtureCandidates.length>0");
  workerCandidates = (await browser.evaluate("fixtureCandidates")).map(
    (candidate) => ({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
    }),
  );
  assert.equal(
    await browser.evaluate(
      `(()=>{const el=document.getElementById('device-${machine}');if(!el)return false;el.click();return true;})()`,
    ),
    true,
  );
  await waitFor(
    "[...document.querySelectorAll('button')].some(button=>button.textContent==='Open sign-in'&&!button.disabled)",
  );
  assert.equal(await browser.clickText("Open sign-in"), true);
  await waitFor(
    "document.querySelector('.signin-view video')?.readyState>=2 && fixtureInputs.length>0",
  );
  const first = await browser.evaluate("fixtureInputs[0]");
  assert.equal(first.sequence, 1);
  assert.equal(first.scope, "windows:sign-in");
  assert.equal(first.instanceId, instance);
  assert.equal("sessionId" in first, false);
  await browser.evaluate(
    "window.fixtureClipboardReads=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{fixtureClipboardReads++;return 'synthetic';}}})",
  );
  const point = await browser.evaluate(
    "(()=>{const r=document.querySelector('.signin-view video').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()",
  );
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...point,
  });
  await browser.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...point,
  });
  await browser.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    ...point,
  });
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    modifiers: 2,
  });
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "v",
    code: "KeyV",
    windowsVirtualKeyCode: 86,
    modifiers: 2,
  });
  await waitFor(
    "fixtureInputs.some(frame=>frame.input.type==='key'&&frame.input.scanCode===30&&frame.input.down)",
  );
  assert.equal(
    await browser.evaluate(
      "fixtureInputs.some(frame=>frame.input.type==='move_pointer')",
    ),
    true,
  );
  assert.equal(await browser.evaluate("fixtureClipboardReads"), 0);
  assert.equal(
    await browser.evaluate(
      "fixtureInputs.some(frame=>frame.input.type==='clipboard_read'||frame.input.type==='type_text')",
    ),
    false,
  );
  const results = [];
  assert.equal(await browser.clickText("Ctrl+Alt+Delete"), true);
  await waitFor(
    "document.querySelector('.viewer-status')?.textContent==='Ctrl+Alt+Delete requested.'",
  );
  assert.equal(
    await browser.evaluate(
      "fixtureInputs.some(frame=>frame.input.type==='secure_attention'&&frame.scope==='windows:sign-in'&&frame.sequence>0)",
    ),
    true,
  );
  await waitFor(
    "[...document.querySelectorAll('.signin-view button')].some(button=>button.textContent==='Ctrl+Alt+Delete'&&!button.disabled)",
  );
  await browser.evaluate("fixtureAttentionStatus='policy-unavailable'");
  assert.equal(await browser.clickText("Ctrl+Alt+Delete"), true);
  await waitFor(
    "document.querySelector('.viewer-status')?.textContent.includes('Windows policy does not allow')",
  );
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [360, 640],
    [844, 390],
    [320, 640],
  ]) {
    await browser.command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    });
    await new Promise((done) => setTimeout(done, 150));
    const geometry = await browser.evaluate(
      "(()=>{const root=document.querySelector('.signin-view');const stop=[...root.querySelectorAll('button')].find(button=>button.textContent==='Stop control').getBoundingClientRect();const video=root.querySelector('video').getBoundingClientRect();const bar=root.querySelector('.viewer-toolbar').getBoundingClientRect();return {overflow:root.scrollWidth>innerWidth,stop:{left:stop.left,top:stop.top,right:stop.right,bottom:stop.bottom},video:{left:video.left,top:video.top,right:video.right,bottom:video.bottom,width:video.width},barBottom:bar.bottom,picture:root.querySelector('video').readyState>=2};})()",
    );
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.picture, true);
    // The picture sits fully inside the window, below the top bar, and is not squeezed to nothing.
    assert.ok(
      geometry.video.left >= 0 &&
        geometry.video.right <= width &&
        geometry.video.bottom <= height &&
        geometry.video.top >= geometry.barBottom - 1 &&
        geometry.video.width >= Math.min(width, 120),
      `picture out of place at ${width}x${height}: ${JSON.stringify(geometry.video)}`,
    );
    assert.ok(
      geometry.stop.left >= 0 &&
        geometry.stop.top >= 0 &&
        geometry.stop.right <= width &&
        geometry.stop.bottom <= height,
    );
    const screenshot = await browser.command("Page.captureScreenshot", {
      format: "png",
    });
    assert.ok(screenshot.result?.data);
    await writeFile(
      join(artifacts, `${width}x${height}.png`),
      Buffer.from(screenshot.result.data, "base64"),
    );
    results.push({ width, height, ...geometry });
  }
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    modifiers: 8,
  });
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    modifiers: 0,
  });
  await waitFor("!document.querySelector('.signin-view')");
  assert.equal(await browser.evaluate("document.body.style.overflow"), "");
  assert.equal(
    await browser.evaluate("document.querySelector('.workspace-nav').inert"),
    false,
  );
  assert.ok(stops >= 1);
  // A second independent reservation exercises the actual React transition to
  // an ordinary RTC viewer. Both producers remain synthetic canvas-only peers.
  await browser.evaluate(
    "clearInterval(fixtureDraw);fixtureTrack.stop();fixtureWorker.close()",
  );
  lease = randomUUID();
  instance = randomUUID();
  context = { leaseId: lease, instanceId: instance, consoleSessionId: 1 };
  offer = await browser.evaluate(
    `(${producer.toString()})(${JSON.stringify(context)})`,
  );
  await waitFor("fixtureCandidates.length>0");
  workerCandidates = (await browser.evaluate("fixtureCandidates")).map(
    ({ candidate, sdpMid, sdpMLineIndex }) => ({
      candidate,
      sdpMid,
      sdpMLineIndex,
    }),
  );
  assert.equal(await browser.clickText("Open sign-in"), true);
  await waitFor("document.querySelector('.signin-view video')?.readyState>=2");
  desktopOffer = await browser.evaluate(`(${producer.toString()})({},true)`);
  await waitFor("fixtureDesktopCandidates.length>0");
  desktopCandidates = (await browser.evaluate("fixtureDesktopCandidates")).map(
    ({ candidate, sdpMid, sdpMLineIndex }) => ({
      candidate,
      sdpMid,
      sdpMLineIndex,
    }),
  );
  const stoppedBeforeTransfer = stops;
  handoffReady = true;
  for (const socket of [...sockets])
    if (!socket.fixtureOrdinary) socket.close();
  await waitFor(
    "!document.querySelector('.signin-view')&&document.querySelector('.live-view video')?.readyState>=2",
  );
  assert.equal(desktopRequests.length, 1);
  assert.deepEqual(desktopRequests[0], {
    source: "desktop",
    capability: "desktop:control",
    requirePolicy: true,
    hostContext: { instanceId: hostInstance, consoleSessionId: 1 },
    signinLeaseId: lease,
  });
  assert.equal(
    stops,
    stoppedBeforeTransfer,
    "disposing the sign-in viewer must not cancel the transferred desktop",
  );
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const handoffScreenshot = await browser.command("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    join(artifacts, "handoff-desktop.png"),
    Buffer.from(handoffScreenshot.result.data, "base64"),
  );
  // The desktop viewer that follows the hand-off has its own End session button.
  assert.equal(
    await browser.evaluate(
      "(()=>{const stop=document.querySelector('.live-view .viewer-stop');if(!stop)return false;stop.click();return true;})()",
    ),
    true,
  );
  await waitFor("!document.querySelector('.live-view')");
  assert.ok(desktopStops >= 1);
  // Exercise the real restart confirmation/reconnect entry. Only fixture
  // presence changes: no machine reboot or native command is executed.
  await browser.evaluate(
    "clearInterval(fixtureDraw);fixtureTrack.stop();fixtureWorker.close();clearInterval(fixtureDesktopDraw);fixtureDesktopTrack.stop();fixtureDesktopWorker.close()",
  );
  machineOnline = true;
  handoffReady = false;
  // Device actions live on the inspector's More tab.
  await waitFor("!!document.querySelector('#inspector-tab-more')");
  await browser.evaluate(
    "document.querySelector('#inspector-tab-more').click()",
  );
  await waitFor(
    "[...document.querySelectorAll('button')].some(button=>button.textContent==='Restart computer…')",
  );
  assert.equal(await browser.clickText("Restart computer…"), true);
  assert.equal(await browser.clickText("Restart"), true);
  await waitFor(
    "[...document.querySelectorAll('.note')].some(note=>note.textContent.includes('Waiting for Windows on'))",
  );
  const restartViewports = [];
  for (const [width, height] of [
    [1440, 900],
    [360, 640],
    [844, 390],
  ]) {
    await browser.command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const geometry = await browser.evaluate(`(()=>{
      const button=document.querySelector('.restart-progress button');
      const rect=button.getBoundingClientRect();
      return {visible:rect.top>=0&&rect.left>=0&&rect.bottom<=innerHeight&&rect.right<=innerWidth,height:rect.height};
    })()`);
    assert.equal(
      geometry.visible,
      true,
      `Cancel reconnect visible at ${width}×${height}`,
    );
    assert.ok(geometry.height >= 44);
    restartViewports.push({ width, height, cancelVisible: true });
    const screenshot = await browser.command("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      join(artifacts, `restart-waiting-${width}x${height}.png`),
      Buffer.from(screenshot.result.data, "base64"),
    );
  }
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const waitingScreenshot = await browser.command("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    join(artifacts, "restart-waiting.png"),
    Buffer.from(waitingScreenshot.result.data, "base64"),
  );
  lease = randomUUID();
  instance = randomUUID();
  context = { leaseId: lease, instanceId: instance, consoleSessionId: 1 };
  offer = await browser.evaluate(
    `(${producer.toString()})(${JSON.stringify(context)})`,
  );
  await waitFor("fixtureCandidates.length>0");
  workerCandidates = (await browser.evaluate("fixtureCandidates")).map(
    ({ candidate, sdpMid, sdpMLineIndex }) => ({
      candidate,
      sdpMid,
      sdpMLineIndex,
    }),
  );
  signInAvailable = true;
  await waitFor("document.querySelector('.signin-view video')?.readyState>=2");
  assert.equal(restartRequests, 1);
  assert.equal(
    desktopRequests.length,
    1,
    "restart enters sign-in before ordinary admission",
  );
  desktopId = randomUUID();
  desktopGrant.id = desktopId;
  hostInstance = randomUUID();
  desktopOffer = await browser.evaluate(`(${producer.toString()})({},true)`);
  await waitFor("fixtureDesktopCandidates.length>0");
  desktopCandidates = (await browser.evaluate("fixtureDesktopCandidates")).map(
    ({ candidate, sdpMid, sdpMLineIndex }) => ({
      candidate,
      sdpMid,
      sdpMLineIndex,
    }),
  );
  handoffReady = true;
  for (const socket of [...sockets])
    if (!socket.fixtureOrdinary) socket.close();
  await waitFor(
    "!document.querySelector('.signin-view')&&document.querySelector('.live-view video')?.readyState>=2",
  );
  assert.equal(desktopRequests.length, 2);
  assert.equal(desktopRequests[1].signinLeaseId, lease);
  assert.deepEqual(desktopRequests[1].hostContext, {
    instanceId: hostInstance,
    consoleSessionId: 1,
  });
  const restartedScreenshot = await browser.command("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(
    join(artifacts, "restart-desktop.png"),
    Buffer.from(restartedScreenshot.result.data, "base64"),
  );
  assert.equal(
    await browser.evaluate(
      "(()=>{const stop=document.querySelector('.live-view .viewer-stop');if(!stop)return false;stop.click();return true;})()",
    ),
    true,
  );
  await waitFor("!document.querySelector('.live-view')");
  machineOnline = true;
  holdOnRestart = true;
  await waitFor("!!document.querySelector('#inspector-tab-more')");
  await browser.evaluate(
    "document.querySelector('#inspector-tab-more').click()",
  );
  await waitFor(
    "[...document.querySelectorAll('button')].some(button=>button.textContent==='Restart computer…')",
  );
  assert.equal(await browser.clickText("Restart computer…"), true);
  assert.equal(await browser.clickText("Restart"), true);
  await waitFor(
    "[...document.querySelectorAll('.note')].some(note=>note.textContent.includes('Waiting for Windows on'))",
  );
  assert.ok(heldReadiness.length > 0);
  const reservationsBeforeCancel = signInReservations;
  assert.equal(await browser.clickText("Cancel reconnect"), true);
  holdSignIn = false;
  signInAvailable = true;
  for (const response of heldReadiness.splice(0))
    if (!response.destroyed) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          enabled: true,
          state: "sign-in",
          endpointReady: true,
          connectable: true,
        }),
      );
    }
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    await browser.evaluate(
      "document.querySelector('.signin-view')===null&&document.querySelector('.live-view')===null",
    ),
    true,
  );
  assert.equal(signInReservations, reservationsBeforeCancel);
  assert.equal(desktopRequests.length, 2);
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify(
      {
        browserOnly: true,
        osInput: false,
        stops,
        results,
        handoff: {
          freshDesktop: true,
          desktopRequests: desktopRequests.length,
          desktopStops,
        },
        restart: {
          requests: restartRequests,
          signInEntered: true,
          freshDesktop: true,
          cancelledLateReadiness: true,
          viewports: restartViewports,
          osReboot: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    `Browser-only sign-in walkthrough passed; screenshots: ${artifacts}`,
  );
} finally {
  if (browser) {
    await browser
      .evaluate(
        "clearInterval(fixtureDraw);fixtureTrack?.stop();fixtureWorker?.close();clearInterval(window.fixtureDesktopDraw);window.fixtureDesktopTrack?.stop();window.fixtureDesktopWorker?.close()",
      )
      .catch(() => {});
    await browser.close();
  }
  for (const socket of sockets) socket.terminate();
  ws.close();
  await server.close();
}
