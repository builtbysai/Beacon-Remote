// Touch becomes the same bounded mouse input a pointer sends (ADR 0021). Two modes:
// - "trackpad": the screen is a trackpad. Moving a finger moves the cursor, a tap clicks,
//   tap then press-and-move drags, two fingers scroll and a two-finger tap right-clicks.
// - "direct": touching a spot moves the cursor there. A tap clicks, a held touch right-clicks,
//   moving the finger drags, and two fingers scroll.
// It only reports actions; the caller sends them and owns authorization and release.
export type TouchMode = "trackpad" | "direct";
export type TouchEvent = {
  kind: "down" | "move" | "up" | "cancel";
  id: number;
  time: number;
  x: number;
  y: number;
};
export type TouchAction =
  | { type: "move"; x: number; y: number }
  | { type: "button"; button: "left" | "right"; down: boolean }
  | { type: "scroll"; horizontal: number; vertical: number };

const TAP_MILLISECONDS = 250;
const TAP_DISTANCE = 10;
const DRAG_GAP_MILLISECONDS = 300;
const LONG_PRESS_MILLISECONDS = 450;
const TRACKPAD_SPEED = 1.6;
const SCROLL_PER_PIXEL = 4;

type Finger = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
};

export class TouchPad {
  private fingers = new Map<number, Finger>();
  private cursor: { x: number; y: number };
  private lastTap = -Infinity;
  private dragging = false;
  private moved = false;
  private longPressed = false;
  private twoFingerStart = 0;
  private twoFingerMoved = false;
  private sawTwo = false;

  constructor(
    private readonly options: {
      mode: () => TouchMode;
      // Remote pixels per client pixel, for relative movement.
      scale: () => number;
      // A client point as a remote pixel, or null outside the picture.
      locate: (x: number, y: number) => { x: number; y: number } | null;
      start: { x: number; y: number };
    },
  ) {
    this.cursor = { ...options.start };
  }

  // A held touch that has not moved becomes a right-click even before the finger lifts.
  pending(time: number): TouchAction[] {
    if (this.options.mode() !== "direct" || this.fingers.size !== 1) return [];
    const [finger] = [...this.fingers.values()];
    if (
      !finger ||
      this.moved ||
      this.longPressed ||
      this.dragging ||
      time - finger.startTime < LONG_PRESS_MILLISECONDS
    )
      return [];
    this.longPressed = true;
    return this.click("right");
  }

  handle(event: TouchEvent): TouchAction[] {
    if (event.kind === "cancel") return this.release();
    const actions: TouchAction[] = [];
    if (event.kind === "down") {
      this.fingers.set(event.id, {
        x: event.x,
        y: event.y,
        startX: event.x,
        startY: event.y,
        startTime: event.time,
      });
      if (this.fingers.size === 1) {
        this.moved = false;
        this.longPressed = false;
        this.sawTwo = false;
        if (this.options.mode() === "direct") {
          const point = this.options.locate(event.x, event.y);
          if (point) {
            this.cursor = point;
            actions.push({ type: "move", ...point });
          }
        } else if (event.time - this.lastTap < DRAG_GAP_MILLISECONDS) {
          // Tap, then press again and move: a drag with the button held.
          this.dragging = true;
          actions.push({ type: "button", button: "left", down: true });
        }
      } else if (this.fingers.size === 2) {
        this.sawTwo = true;
        this.twoFingerStart = event.time;
        this.twoFingerMoved = false;
        // A second finger turns a drag in progress into nothing: release the button first.
        actions.push(...this.endDrag());
      }
      return actions;
    }
    const finger = this.fingers.get(event.id);
    if (!finger) return actions;
    if (event.kind === "move") {
      const dx = event.x - finger.x;
      const dy = event.y - finger.y;
      finger.x = event.x;
      finger.y = event.y;
      if (this.fingers.size >= 2) {
        if (
          Math.hypot(event.x - finger.startX, event.y - finger.startY) >
          TAP_DISTANCE
        )
          this.twoFingerMoved = true;
        if (this.twoFingerMoved)
          actions.push({
            type: "scroll",
            // Two fingers move together: each reports half of the shared motion.
            horizontal: Math.round((dx * SCROLL_PER_PIXEL) / 2),
            vertical: Math.round((dy * SCROLL_PER_PIXEL) / 2),
          });
        return actions;
      }
      if (
        Math.hypot(event.x - finger.startX, event.y - finger.startY) >
        TAP_DISTANCE
      )
        this.moved = true;
      if (this.options.mode() === "direct") {
        if (this.moved && !this.dragging && !this.longPressed) {
          // Moving a held finger drags from where it first touched.
          this.dragging = true;
          actions.push({ type: "button", button: "left", down: true });
        }
        const point = this.options.locate(event.x, event.y);
        if (point && this.moved) {
          this.cursor = point;
          actions.push({ type: "move", ...point });
        }
      } else if (dx !== 0 || dy !== 0) {
        const factor = this.options.scale() * TRACKPAD_SPEED;
        this.cursor = {
          x: this.cursor.x + dx * factor,
          y: this.cursor.y + dy * factor,
        };
        actions.push({
          type: "move",
          x: Math.round(this.cursor.x),
          y: Math.round(this.cursor.y),
        });
      }
      return actions;
    }
    // up
    this.fingers.delete(event.id);
    const duration = event.time - finger.startTime;
    const travelled = Math.hypot(
      event.x - finger.startX,
      event.y - finger.startY,
    );
    if (this.sawTwo) {
      if (
        this.fingers.size === 0 &&
        !this.twoFingerMoved &&
        event.time - this.twoFingerStart < TAP_MILLISECONDS
      )
        actions.push(...this.click("right"));
      if (this.fingers.size === 0) this.sawTwo = false;
      return actions;
    }
    if (this.fingers.size > 0) return actions;
    if (this.dragging) {
      actions.push(...this.endDrag());
      this.lastTap = -Infinity;
      return actions;
    }
    if (this.longPressed) return actions;
    if (duration < TAP_MILLISECONDS && travelled <= TAP_DISTANCE) {
      actions.push(...this.click("left"));
      this.lastTap = event.time;
    }
    return actions;
  }

  // Cancel, blur or a lost channel: nothing stays held.
  release(): TouchAction[] {
    const actions = this.endDrag();
    this.fingers.clear();
    this.sawTwo = false;
    this.lastTap = -Infinity;
    return actions;
  }

  private endDrag(): TouchAction[] {
    if (!this.dragging) return [];
    this.dragging = false;
    return [{ type: "button", button: "left", down: false }];
  }

  private click(button: "left" | "right"): TouchAction[] {
    return [
      { type: "button", button, down: true },
      { type: "button", button, down: false },
    ];
  }
}
