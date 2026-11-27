// The viewer's side of the `beacon-clipboard-v1` channel (ADR 0060). The computer decides what may move: its own
// setting is Off, Button only or Automatic, announced here as a `mode` message whenever it changes. A write needs the
// person at the computer to have approved it for this connection (Automatic counts as approval); the computer says
// "needs-approval" and the viewer then asks for the Clipboard permission. Contents are never logged.

export type ClipboardMode = "off" | "button" | "auto";

/** The most characters one write may carry; the computer refuses more. */
export const MAX_WRITE_CHARS = 8_000;

export class ClipboardRefused extends Error {
  constructor(readonly reason: string) {
    super(
      reasonText[reason] ??
        `The computer refused the clipboard request (${reason}).`,
    );
  }
}

const reasonText: Record<string, string> = {
  off: "Clipboard sharing is off on this computer.",
  paused: "Sharing is paused on the computer.",
  "needs-control": "Clipboard sharing needs control of the computer.",
  "needs-approval": "The computer has not allowed this yet.",
  "too-long": `That text is longer than ${MAX_WRITE_CHARS.toLocaleString()} characters.`,
  "too-fast": "Wait a moment, then try again.",
  unavailable: "The computer's clipboard is busy. Try again.",
  invalid: "The computer could not read that request.",
};

export type ClipboardTransport = {
  readonly open: boolean;
  send(text: string): void;
};

export type ClipboardEvents = {
  /** The computer's setting, when the channel opens and whenever the person there changes it. */
  mode(mode: ClipboardMode, approved: boolean): void;
  /** Text the computer pushed because Automatic is on and something was copied there. */
  pushed(text: string, truncated: boolean): void;
};

type Pending = {
  resolve: (reply: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

const modes: readonly string[] = ["off", "button", "auto"];

export class ClipboardClient {
  private queue: Pending[] = [];
  constructor(
    private readonly transport: ClipboardTransport,
    private readonly events: ClipboardEvents,
  ) {}

  /** Every text message from the computer on the clipboard channel. */
  receive(text: string): void {
    let reply: Record<string, unknown>;
    try {
      reply = JSON.parse(text);
    } catch {
      this.queue
        .shift()
        ?.reject(new Error("The computer sent an unreadable reply."));
      return;
    }
    // Messages the computer sends on its own never answer a request.
    if (reply.type === "mode") {
      if (typeof reply.mode === "string" && modes.includes(reply.mode))
        this.events.mode(reply.mode as ClipboardMode, reply.approved === true);
      return;
    }
    if (reply.type === "clipboard" && reply.auto === true) {
      if (typeof reply.text === "string")
        this.events.pushed(reply.text, reply.truncated === true);
      return;
    }
    const pending = this.queue.shift();
    if (!pending) return;
    if (reply.type === "refused")
      pending.reject(new ClipboardRefused(String(reply.reason ?? "unknown")));
    else pending.resolve(reply);
  }

  close(): void {
    for (const pending of this.queue.splice(0))
      pending.reject(new Error("The clipboard connection ended."));
  }

  private run(
    message: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.transport.open)
      return Promise.reject(new Error("Clipboard sharing is not connected."));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.transport.send(JSON.stringify(message));
    });
  }

  /** Asks the computer for its setting; it also announces it by itself when the channel opens. */
  hello(): void {
    if (this.transport.open)
      this.transport.send(JSON.stringify({ op: "hello" }));
  }

  /** Sets the computer's clipboard. Rejects with the computer's reason when it refuses. */
  async write(text: string): Promise<void> {
    if (text.length === 0) throw new Error("There is nothing to send.");
    if ([...text].length > MAX_WRITE_CHARS)
      throw new ClipboardRefused("too-long");
    const reply = await this.run({ op: "write", text });
    if (reply.type !== "written")
      throw new Error("The computer did not confirm the clipboard was set.");
  }

  /** Reads the computer's clipboard text. */
  async read(): Promise<{ text: string; truncated: boolean }> {
    const reply = await this.run({ op: "read" });
    if (reply.type !== "clipboard" || typeof reply.text !== "string")
      throw new Error("The computer sent an unreadable clipboard.");
    if (reply.unavailable === true)
      throw new Error("The computer has no text on its clipboard.");
    return { text: reply.text, truncated: reply.truncated === true };
  }
}
