// The pure core of semantic UI targets (ADR 0064). Given a raw interface tree reported by a host, this builds a bounded,
// filtered snapshot whose elements are addressed by a number valid only inside that snapshot, and refuses a command that
// names a stale snapshot or an unknown element. It reads nothing from a computer and grants nothing: no tool exposes it
// yet, and the closed tool list in agent-scope.mjs is unchanged.

export const LIMITS = Object.freeze({
  maxNodes: 500,
  maxDepth: 12,
  maxName: 120,
  lifetimeMs: 10_000,
  maxSnapshots: 4,
});

const ROLE = /^[a-z][a-z0-9_-]{0,31}$/;
const STATES = new Set([
  "enabled",
  "disabled",
  "focused",
  "checked",
  "unchecked",
  "selected",
  "expanded",
  "collapsed",
  "offscreen",
]);

const finite = (value) =>
  Number.isFinite(value) && Math.abs(value) <= 1_000_000;

function cleanBounds(bounds) {
  if (!bounds) return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(finite) || width < 0 || height < 0)
    return null;
  return { x, y, width, height };
}

/**
 * Builds the snapshot nodes from a raw tree of `{ role, name, value, protected, states, bounds, children }`.
 * Only role, name, state and bounds are kept. A protected field (a password box, or anything the host marks protected)
 * keeps its role and never its name or value. Depth and node count are capped; the cut is reported, never hidden.
 */
export function buildNodes(raw, limits = LIMITS) {
  const nodes = [];
  let truncated = false;
  const walk = (item, depth, parent) => {
    if (!item || typeof item !== "object") return;
    if (nodes.length >= limits.maxNodes || depth > limits.maxDepth) {
      truncated = true;
      return;
    }
    const role =
      typeof item.role === "string" && ROLE.test(item.role)
        ? item.role
        : "unknown";
    const secret = item.protected === true || role === "password";
    const node = {
      ref: nodes.length + 1,
      parent,
      role,
      ...(secret ? { protected: true } : {}),
      ...(!secret && typeof item.name === "string" && item.name
        ? { name: item.name.slice(0, limits.maxName) }
        : {}),
      states: Array.isArray(item.states)
        ? item.states.filter((state) => STATES.has(state))
        : [],
      bounds: cleanBounds(item.bounds),
    };
    nodes.push(node);
    if (Array.isArray(item.children))
      for (const child of item.children) walk(child, depth + 1, node.ref);
  };
  walk(raw, 0, 0);
  return { nodes, truncated };
}

/** Keeps a few recent snapshots, each valid for a short time. A command names `{ snapshot, ref }`. */
export function createSnapshotStore(limits = LIMITS) {
  const held = new Map();
  let counter = 0;
  return {
    add(raw, now = Date.now(), display = null) {
      const { nodes, truncated } = buildNodes(raw, limits);
      const id = ++counter;
      held.set(id, { nodes, display, expiresAt: now + limits.lifetimeMs });
      // Only the newest few stay; an older one is gone, so a command naming it is refused as unknown.
      for (const key of [...held.keys()]) {
        if (key <= id - limits.maxSnapshots) held.delete(key);
      }
      return {
        snapshot: id,
        expiresAt: now + limits.lifetimeMs,
        truncated,
        nodes,
      };
    },
    /** Resolves a target, or says why not. Never falls back to another snapshot or a position. */
    resolve(snapshot, ref, now = Date.now()) {
      const entry = held.get(snapshot);
      if (!entry) return { ok: false, reason: "unknown-snapshot" };
      if (now >= entry.expiresAt) {
        held.delete(snapshot);
        return { ok: false, reason: "stale-snapshot" };
      }
      const node = Number.isInteger(ref) ? entry.nodes[ref - 1] : undefined;
      if (!node) return { ok: false, reason: "unknown-ref" };
      if (node.protected) return { ok: false, reason: "protected-field" };
      if (!node.bounds) return { ok: false, reason: "no-bounds" };
      return { ok: true, node, display: entry.display };
    },
  };
}

/**
 * Where to click on the picture to reach a target: the centre of its box, taken from the display the boxes are on to the
 * video the viewer is looking at. With no display reported the boxes are taken to be in video pixels already. It refuses a
 * target that is off screen, disabled, has no box, or whose centre is not on that display, and never guesses.
 */
export function targetPoint(node, display, video) {
  const box = node.bounds;
  if (!box || box.width <= 0 || box.height <= 0)
    return { ok: false, reason: "no-bounds" };
  if (node.states.includes("offscreen"))
    return { ok: false, reason: "offscreen" };
  if (node.states.includes("disabled"))
    return { ok: false, reason: "disabled" };
  if (
    !Number.isFinite(video?.width) ||
    !Number.isFinite(video?.height) ||
    video.width < 1 ||
    video.height < 1
  )
    return { ok: false, reason: "no-picture" };
  const area = display ?? {
    x: 0,
    y: 0,
    width: video.width,
    height: video.height,
  };
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  if (
    centreX < area.x ||
    centreY < area.y ||
    centreX >= area.x + area.width ||
    centreY >= area.y + area.height
  )
    return { ok: false, reason: "outside-display" };
  const x = Math.round(((centreX - area.x) * video.width) / area.width);
  const y = Math.round(((centreY - area.y) * video.height) / area.height);
  return {
    ok: true,
    x: Math.min(x, video.width - 1),
    y: Math.min(y, video.height - 1),
  };
}

/** What a receipt records about an action on a target: the role and the number, never the element's text. */
export function receiptFor(snapshot, node) {
  return { snapshot, ref: node.ref, role: node.role };
}
