// The viewer's side of the `beacon-print-v1` channel (P2-1). A job is sent as begin, then bounded chunks, then print.
// Each message gets one reply; a refusal rejects with its reason, and nothing is printed unless the computer
// confirms the whole job was received.

export const PRINT_CHUNK = 256 * 1024;

export class PrintRefused extends Error {
  constructor(readonly reason: string) {
    super(
      printReasonText[reason] ??
        `The computer refused the print job (${reason}).`,
    );
  }
}

const printReasonText: Record<string, string> = {
  "not-permitted": "Ask for Printing access first, then try again.",
  "printer-not-selected":
    "That printer is not allowed for remote printing on this computer.",
  "too-large": "That file is larger than the computer allows for printing.",
  "over-declared": "The file changed while it was sent. Try again.",
  spooler: "The printer could not take the job.",
  "spooler-failed": "The printer could not take the job.",
};

export type PrintTransport = {
  readonly open: boolean;
  send(text: string): void;
};

type Pending = {
  resolve: (reply: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

export class PrintClient {
  private queue: Pending[] = [];
  constructor(private readonly transport: PrintTransport) {}

  /** Every text message from the computer on the print channel. */
  receive(text: string): void {
    const pending = this.queue.shift();
    if (!pending) return;
    let reply: Record<string, unknown>;
    try {
      reply = JSON.parse(text);
    } catch {
      pending.reject(new Error("The computer sent an unreadable reply."));
      return;
    }
    if (reply.type === "refused")
      pending.reject(new PrintRefused(String(reply.reason ?? "unknown")));
    else pending.resolve(reply);
  }

  close(): void {
    for (const pending of this.queue.splice(0)) {
      pending.reject(new Error("The print connection ended."));
    }
  }

  private run(
    message: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.transport.open)
      return Promise.reject(new Error("Printing is not connected."));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.transport.send(JSON.stringify(message));
    });
  }

  /** Sends one whole file to a printer and resolves only when the computer reports it printed. */
  async printFile(
    id: number,
    printer: string,
    bytes: Uint8Array,
    onProgress?: (done: number) => void,
  ): Promise<void> {
    if (bytes.length === 0) throw new Error("Empty files are not printed.");
    await this.run({ op: "begin", id, printer, size: bytes.length });
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.subarray(offset, offset + PRINT_CHUNK);
      let binary = "";
      for (const byte of chunk) binary += String.fromCharCode(byte);
      const reply = await this.run({ op: "chunk", id, data: btoa(binary) });
      if (reply.type !== "received")
        throw new Error("Unexpected reply while sending the file.");
      offset += chunk.length;
      onProgress?.(offset);
    }
    const done = await this.run({ op: "print", id });
    if (done.type !== "printed")
      throw new Error("The computer did not confirm printing.");
  }
}
