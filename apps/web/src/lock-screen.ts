// The phone cannot send a picture of its PIN screen (Android hides it), so it sends the screen's layout: captions and
// where they sit. This checks one such message before the viewer draws anything from it.
export type LockScreenNode = {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  kind: "key" | "text";
};
export type LockScreen = {
  state: "off" | "not-locked" | "no-pad" | "pad";
  w: number;
  h: number;
  nodes: LockScreenNode[];
};

const finite = (value: unknown, max = 20000): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;

export function lockScreenShape(message: unknown): LockScreen | null {
  if (message === null || typeof message !== "object") return null;
  const raw = message as Record<string, unknown>;
  const state = raw.state;
  if (
    state !== "off" &&
    state !== "not-locked" &&
    state !== "no-pad" &&
    state !== "pad"
  )
    return null;
  if (!finite(raw.w) || !finite(raw.h) || raw.w === 0 || raw.h === 0)
    return null;
  const nodes: LockScreenNode[] = [];
  if (state === "pad") {
    if (!Array.isArray(raw.nodes) || raw.nodes.length > 60) return null;
    for (const item of raw.nodes as unknown[]) {
      const node = item as Record<string, unknown>;
      if (
        item === null ||
        typeof item !== "object" ||
        !finite(node.x) ||
        !finite(node.y) ||
        !finite(node.w) ||
        !finite(node.h) ||
        typeof node.text !== "string" ||
        node.text.length > 24 ||
        (node.kind !== "key" && node.kind !== "text")
      )
        return null;
      nodes.push({
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        text: node.text,
        kind: node.kind,
      });
    }
  }
  return { state, w: raw.w, h: raw.h, nodes };
}

// Which key a drawn button stands for, or null when it is not one the pad may press.
export function lockKeyFor(text: string): string | null {
  if (/^[0-9]$/.test(text)) return text;
  if (text === "Delete") return "delete";
  if (text === "Enter") return "enter";
  return null;
}
