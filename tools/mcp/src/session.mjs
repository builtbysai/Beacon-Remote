import { buildControlScript } from "./control-sender.mjs";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const readState = `(() => {
  const panel=document.querySelector('.live-view');
  const video=panel?.querySelector('video');
  return {state:panel?.dataset.state??null,id:panel?.dataset.sessionId??null,
    picture:Boolean(video?.videoWidth),width:video?.videoWidth??0,height:video?.videoHeight??0};
})()`;
const text = (value) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});
const failure = (message) => ({ isError: true, ...text(message) });

/** One reserved viewer slot, including asynchronous setup and teardown. */
export class RemoteSession {
  constructor({ origin, list, open, stop, maxMs = 600_000, pollMs = 250 }) {
    Object.assign(this, { origin, list, open, stop, maxMs, pollMs });
    this.current = null;
  }
  live(record) {
    return (
      this.current === record && !record.ended && Date.now() < record.deadline
    );
  }
  /**
   * Runs one control command in the live viewer. The caller has already passed the scope gate; this only checks
   * that the session is still live and that the page accepted the event. Stop is handled by ending the session.
   */
  async control(tool, args) {
    const record = this.current;
    if (!record || !this.live(record) || !record.viewer) {
      return { ok: false, reason: "not-connected" };
    }
    if (tool === "stop") {
      await this.end(record);
      return { ok: true, result: null };
    }
    const script = buildControlScript(tool, args);
    if (!script) return { ok: false, reason: "invalid" };
    const accepted = await record.viewer.evaluate(script);
    return accepted === true ? { ok: true, result: null } : { ok: false, reason: "not-ready" };
  }

  async end(record = this.current) {
    if (!record) return false;
    record.ended = true;
    clearTimeout(record.timer);
    if (!record.cleanup)
      record.cleanup = (async () => {
        if (record.opening && !record.viewer) {
          try {
            record.viewer = await record.opening;
          } catch {
            /* Startup failed before a browser existed. */
          }
        }
        const viewer = record.viewer;
        if (viewer) {
          try {
            const info = await viewer.evaluate(readState);
            if (
              typeof info?.id === "string" &&
              /^[a-f0-9-]{36}$/i.test(info.id)
            )
              await this.stop(info.id);
            else await viewer.clickText("Stop viewing");
          } catch {
            /* Closing the browser also detaches its transport; native leases remain bounded. */
          } finally {
            await viewer.close();
          }
        }
        if (this.current === record) this.current = null;
      })();
    try {
      await record.cleanup;
    } catch {
      record.cleanup = null;
      throw Error(
        "Viewer cleanup is incomplete. Retry end_session before starting another session.",
      );
    }
    return true;
  }
  async request({ computer_id, wait_seconds }, signal) {
    if (this.current)
      return failure("A session is already open or starting. End it first.");
    const record = {
      deadline: Date.now() + this.maxMs,
      ended: false,
      viewer: null,
      computer: null,
    };
    this.current = record;
    record.timer = setTimeout(
      () => void this.end(record).catch(() => {}),
      this.maxMs,
    );
    record.timer.unref?.();
    const abort = () => void this.end(record).catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw Error("cancelled");
      const machines = await this.list();
      if (!this.live(record)) throw Error("cancelled");
      const machine = machines.find(
        (m) => m.id === computer_id && !m.revokedAt,
      );
      if (!machine?.online) {
        await this.end(record);
        return failure(
          machine
            ? "That computer is offline."
            : "That computer is unavailable to this account.",
        );
      }
      record.computer = machine.name;
      record.opening = this.open();
      const viewer = await record.opening;
      record.viewer = viewer;
      if (!this.live(record)) {
        await this.end(record);
        return failure("The request was cancelled or timed out.");
      }
      await viewer.goto(`${this.origin}/#computers`);
      if (!this.live(record)) throw Error("cancelled");
      const clicked = await viewer.evaluate(`(() => {
        const row=document.getElementById(${JSON.stringify(`device-${computer_id}`)})?.closest('article');
        const button=row?.querySelector('.device-open');
        if(!button||button.disabled)return false;
        button.click();return true;
      })()`);
      if (!clicked) {
        await this.end(record);
        return failure(
          "Viewing is unavailable or another session is already in progress.",
        );
      }
      const deadline = Math.min(
        record.deadline,
        Date.now() + wait_seconds * 1000,
      );
      while (this.live(record) && Date.now() < deadline) {
        const info = await viewer.evaluate(readState);
        if (!this.live(record)) break;
        if (info?.state === "viewing" && info.picture)
          return text({
            status: "viewing",
            computer: machine.name,
            seconds_left: Math.max(
              0,
              Math.floor((record.deadline - Date.now()) / 1000),
            ),
          });
        if (info?.state === "ended") break;
        await delay(this.pollMs);
      }
      await this.end(record);
      return failure(
        "The request ended, was cancelled, or was not approved in time.",
      );
    } catch {
      await this.end(record);
      return failure(
        "The viewer could not complete this request. Check sign-in, computer availability and local approval.",
      );
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async screenshot() {
    const record = this.current;
    if (!record || !this.live(record) || !record.viewer)
      return failure("No active picture. Request a session first.");
    try {
      const data = await record.viewer.evaluate(`(() => {
        const panel=document.querySelector('.live-view');
        const video=panel?.querySelector('video');
        if(panel?.dataset.state!=='viewing'||!video?.videoWidth||video.readyState<2)return null;
        const scale=Math.min(1,1280/video.videoWidth,1280/video.videoHeight);
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
        canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      if (!data || !this.live(record))
        return failure("No active picture; sharing may be paused or ended.");
      return { content: [{ type: "image", data, mimeType: "image/png" }] };
    } catch {
      return failure("The viewer is unavailable.");
    }
  }
  async status() {
    const record = this.current;
    if (!record) return text({ open: false });
    if (record.ended) return text({ open: false, cleanupPending: true });
    if (!this.live(record)) return text({ open: false });
    if (!record.viewer)
      return text({ open: true, state: "starting", computer: record.computer });
    try {
      const info = await record.viewer.evaluate(readState);
      if (!this.live(record)) return text({ open: false });
      if (info?.state === "ended") {
        await this.end(record);
        return text({ open: false });
      }
      return text({
        open: true,
        computer: record.computer,
        state: info?.state ?? "starting",
        seconds_left: Math.max(
          0,
          Math.floor((record.deadline - Date.now()) / 1000),
        ),
        width: info?.width ?? 0,
        height: info?.height ?? 0,
      });
    } catch {
      await this.end(record);
      return text({ open: false });
    }
  }
}

export function checkedOrigin(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw Error("Use an HTTPS origin, or loopback HTTP for local testing.");
  return url.origin;
}

export function accountApi({ origin, cookie = "", email, password }) {
  if (cookie && !/^[A-Za-z0-9._~-]{16,512}$/.test(cookie))
    throw Error("Invalid session cookie format");
  async function call(path, body) {
    const response = await fetch(`${origin}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        origin,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie: `remote_session=${cookie}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw Error(`Request failed (${response.status})`);
    return response;
  }
  let signingIn;
  async function signIn() {
    if (cookie) return;
    if (!signingIn)
      signingIn = (async () => {
        if (!email || !password)
          throw Error("Configure a dedicated account or session cookie.");
        const response = await call("login", { email, password });
        const set = response.headers
          .getSetCookie()
          .find((c) => c.startsWith("remote_session="));
        if (!set)
          throw Error(
            "Complete two-step sign-in interactively and supply its session cookie. Keep two-step sign-in enabled.",
          );
        const nextCookie = set.split(";")[0].slice("remote_session=".length);
        if (!/^[A-Za-z0-9._~-]{16,512}$/.test(nextCookie))
          throw Error("Invalid session cookie format");
        cookie = nextCookie;
      })().finally(() => {
        signingIn = null;
      });
    await signingIn;
  }
  return {
    async getCookie() {
      await signIn();
      return cookie;
    },
    async api(path, body) {
      await signIn();
      return (await call(path, body)).json();
    },
  };
}
