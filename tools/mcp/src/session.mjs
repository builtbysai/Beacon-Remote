import {
  buildControlScript,
  uiTreeAskScript,
  uiTreeReadScript,
} from "./control-sender.mjs";
import { createSnapshotStore, targetPoint } from "./ui-snapshot.mjs";
import { createScope, revoke } from "./agent-scope.mjs";
import { runControl } from "./control-tools.mjs";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const readState = `(() => {
  const panel=document.querySelector('.live-view');
  const video=panel?.querySelector('video');
  return {state:panel?.dataset.state??null,id:panel?.dataset.sessionId??null,control:panel?.dataset.control??null,
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
   * Gives the assistant a control scope only when the owner has already granted control on the computer, which the
   * viewer shows as data-control="granted". The scope lasts no longer than the session and at most ten minutes.
   */
  async grantControlScope(record, computerId) {
    if (!record || !this.live(record) || !record.viewer) return null;
    const info = await record.viewer.evaluate(
      `(() => ({ control: document.querySelector('.live-view')?.dataset.control ?? null }))()`,
    );
    if (info?.control !== "granted") return null;
    const expiresAt = Math.min(record.deadline, Date.now() + 10 * 60 * 1000);
    record.scope = createScope({
      computerId,
      tools: ["pointer", "keyboard", "clipboard_read", "stop"],
      expiresAt,
    });
    return record.scope;
  }

  /**
   * The interface tree of the shared window, as a snapshot whose elements are addressed by number (ADR 0064). The person
   * at the computer decides: until they approve the Screen structure permission the computer answers "denied", this asks
   * for it and says so, and no scope exists. The scope is created only once the computer has actually returned a tree,
   * so it reflects an approval that really happened; it ends with the session and lasts at most ten minutes.
   */
  async uiTree(computerId, key) {
    const record = this.current;
    if (!record || !this.live(record) || !record.viewer)
      return { ok: false, reason: "no-session" };
    let first = null;
    if (!record.uiScope) {
      const probe = await record.viewer.evaluate(uiTreeReadScript);
      if (!probe?.ok) {
        if (probe?.reason === "denied") {
          await record.viewer.evaluate(uiTreeAskScript);
          return { ok: false, reason: "awaiting-owner-approval" };
        }
        return {
          ok: false,
          reason:
            typeof probe?.reason === "string" ? probe.reason : "unavailable",
        };
      }
      record.uiScope = createScope({
        computerId,
        tools: ["ui_tree"],
        expiresAt: Math.min(record.deadline, Date.now() + 10 * 60 * 1000),
      });
      first = probe;
    }
    record.snapshots ??= createSnapshotStore();
    const result = await runControl({
      scope: record.uiScope,
      command: { computerId, tool: "ui_tree", args: {}, key },
      send: async () =>
        first ?? (await record.viewer.evaluate(uiTreeReadScript)),
    });
    if (!result.ok) return result;
    if (result.duplicate) return result;
    const answer = result.result;
    if (!answer?.ok)
      return {
        ok: false,
        reason:
          typeof answer?.reason === "string" ? answer.reason : "unavailable",
        receipt: result.receipt,
      };
    const shot = record.snapshots.add(
      answer.tree,
      Date.now(),
      answer.display ?? null,
    );
    return {
      ok: true,
      snapshot: shot.snapshot,
      expiresAt: shot.expiresAt,
      truncated: shot.truncated || answer.truncated === true,
      nodes: shot.nodes,
      receipt: result.receipt,
    };
  }

  /** Runs one control command in the live viewer through the scope gate. Stop ends the session. */
  async control(tool, args, key) {
    const record = this.current;
    if (!record || !record.scope)
      return { ok: false, reason: "no-control-scope" };
    // A pointer command may name a target from a snapshot instead of a point. The click lands at the centre of its box,
    // mapped from the display the boxes are on to the picture; a stale, unknown, protected or off-screen target is refused.
    if (args && args.target !== undefined) {
      const { target } = args;
      if (tool !== "pointer")
        return { ok: false, reason: "target-only-for-pointer" };
      if (!Number.isInteger(target?.snapshot) || !Number.isInteger(target?.ref))
        return { ok: false, reason: "invalid-target" };
      const resolved = record.snapshots?.resolve(target.snapshot, target.ref);
      if (!resolved?.ok)
        return { ok: false, reason: resolved?.reason ?? "unknown-snapshot" };
      const info = await record.viewer.evaluate(readState);
      const point = targetPoint(resolved.node, resolved.display, {
        width: info?.width,
        height: info?.height,
      });
      if (!point.ok) return point;
      args = { x: point.x, y: point.y, button: args.button ?? "left" };
    }
    return runControl({
      scope: record.scope,
      command: { computerId: record.scope.computerId, tool, args, key },
      send: async (name, values) => {
        if (name === "stop") {
          await this.end(record);
          return null;
        }
        const script = buildControlScript(name, values);
        if (!script) throw new Error("invalid");
        const accepted = await record.viewer.evaluate(script);
        if (accepted !== true) throw new Error("not-ready");
        return null;
      },
    });
  }

  async end(record = this.current) {
    if (!record) return false;
    record.ended = true;
    if (record.scope) revoke(record.scope);
    if (record.uiScope) revoke(record.uiScope);
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
