// The browser side of the P1-1 control sender. It builds the script that the MCP session runs inside the real
// viewer page: pointer, key and clipboard events are dispatched on the viewer's <video>, the element the viewer's
// own input code listens to, so commands travel the existing input channel and lease. Nothing opens a second
// connection. The script is built only from validated arguments; the page itself refuses anything unexpected.

const KEY_CODES = Object.freeze({
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  Delete: "Delete",
});

const video = `(document.querySelector('[data-state="viewing"] video') ?? document.querySelector('video'))`;

/**
 * Page scripts for the semantic-target tool (ADR 0064). "Read" asks the viewer for the computer's interface tree and
 * resolves with its checked answer (`{ ok, tree }` or `{ ok: false, reason }`); "ask" requests the Screen structure
 * permission, which only the person at the computer can approve.
 */
export const uiTreeReadScript = `new Promise((done) => {
  const el = ${video};
  if (!el) { done({ ok: false, reason: "closed" }); return; }
  el.dispatchEvent(new CustomEvent("beacon-ui-tree-read", { detail: { done } }));
})`;
export const uiTreeAskScript = `(() => { const el = ${video}; if (!el) return false; el.dispatchEvent(new Event("beacon-ui-tree-ask")); return true; })()`;

/** The keyboard event `code` for a key name, or null if the name is not one we send. */
export function keyCode(name) {
  if (typeof name !== "string") return null;
  if (KEY_CODES[name]) return KEY_CODES[name];
  if (/^[a-z]$/i.test(name)) return `Key${name.toUpperCase()}`;
  if (/^[0-9]$/.test(name)) return `Digit${name}`;
  return null;
}

/**
 * The page script for one control command. `x` and `y` are in the computer's video pixels; the script maps them
 * through the viewer's object-fit letterbox to client coordinates. Returns null for a command it cannot build.
 */
export function buildControlScript(tool, args) {
  const video = `(document.querySelector('[data-state="viewing"] video') ?? document.querySelector('video'))`;
  if (tool === "pointer") {
    const { x, y, button = "none" } = args;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    const point = `(() => {
      const el = ${video};
      if (!el || !el.videoWidth) return false;
      const rect = el.getBoundingClientRect();
      const scale = Math.min(rect.width / el.videoWidth, rect.height / el.videoHeight);
      const left = rect.left + (rect.width - el.videoWidth * scale) / 2;
      const top = rect.top + (rect.height - el.videoHeight * scale) / 2;
      return { el, clientX: left + ${x} * scale, clientY: top + ${y} * scale };
    })()`;
    const init = (buttons) =>
      `{bubbles:true,cancelable:true,pointerId:1,pointerType:"mouse",clientX:p.clientX,clientY:p.clientY,button:${buttons ? 0 : -1},buttons:${buttons}}`;
    if (button === "none") {
      return `(() => { const p = ${point}; if (!p) return false; p.el.dispatchEvent(new PointerEvent("pointermove", ${init(0)})); return true; })()`;
    }
    const pressed = button === "right" ? 2 : 1;
    return `(() => { const p = ${point}; if (!p) return false;
      p.el.dispatchEvent(new PointerEvent("pointermove", ${init(0)}));
      p.el.dispatchEvent(new PointerEvent("pointerdown", ${init(pressed)}));
      p.el.dispatchEvent(new PointerEvent("pointerup", ${init(0)}));
      return true; })()`;
  }
  if (tool === "keyboard") {
    const code = keyCode(args.key);
    if (!code) return null;
    return `(() => { const el = ${video}; if (!el) return false;
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: ${JSON.stringify(args.key)}, code: ${JSON.stringify(code)} }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: ${JSON.stringify(args.key)}, code: ${JSON.stringify(code)} }));
      return true; })()`;
  }
  if (tool === "clipboard_read") {
    return `(() => { const el = ${video}; if (!el) return false; el.dispatchEvent(new Event("beacon-clipboard-read")); return true; })()`;
  }
  return null;
}
