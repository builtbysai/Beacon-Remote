import {
  uiTreeResponse,
  type UiNode,
  type UiTreeResponse,
} from "@beacon-remote/protocol";

// The viewer's side of the `beacon-ui-tree-v1` channel (ADR 0064). It asks the computer for the interface tree of the
// window it is sharing and checks the answer against the shared, strict schema before anyone sees it. The computer
// decides: until the person there approves the "Screen structure" permission it answers "denied". Contents are never
// logged.

export type UiTreeTransport = {
  readonly open: boolean;
  send(text: string): void;
};

export type UiTreeResult =
  | { ok: true; truncated: boolean; tree: UiNode }
  | {
      ok: false;
      reason:
        "denied" | "busy" | "unavailable" | "timeout" | "closed" | "invalid";
    };

export const REQUEST_TIMEOUT_MS = 5_000;

export class UiTreeClient {
  private pending = new Map<
    string,
    {
      resolve: (result: UiTreeResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly transport: UiTreeTransport,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {}

  /** Asks for the tree. Never rejects: the answer says why when there is no tree. */
  request(): Promise<UiTreeResult> {
    if (!this.transport.open)
      return Promise.resolve({ ok: false, reason: "closed" });
    const id = this.newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, reason: "timeout" });
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      try {
        this.transport.send(JSON.stringify({ type: "ui-tree-request", id }));
      } catch {
        this.settle(id, { ok: false, reason: "closed" });
      }
    });
  }

  /** A message from the computer. An answer to a request nobody made, or one that breaks the schema, is dropped. */
  receive(text: string): void {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = uiTreeResponse.safeParse(value);
    if (!parsed.success) {
      // A well-formed envelope with a bad tree still ends the request it answers, so the caller is not left waiting.
      const id = (value as { id?: unknown } | null)?.id;
      if (typeof id === "string" && this.pending.has(id))
        this.settle(id, { ok: false, reason: "invalid" });
      return;
    }
    this.settle(parsed.data.id, toResult(parsed.data));
  }

  /** The channel closed: everything waiting is told so. */
  close(): void {
    for (const id of [...this.pending.keys()])
      this.settle(id, { ok: false, reason: "closed" });
  }

  private settle(id: string, result: UiTreeResult): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(result);
  }
}

function toResult(message: UiTreeResponse): UiTreeResult {
  return message.ok
    ? { ok: true, truncated: message.truncated, tree: message.tree }
    : { ok: false, reason: message.reason };
}
