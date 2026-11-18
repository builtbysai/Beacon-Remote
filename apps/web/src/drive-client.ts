// The viewer's side of the `beacon-drive-v1` channel (P1-4). Commands go out one at a time as JSON; each reply
// answers the oldest outstanding command. A refusal or a dead channel rejects the request, so the UI can say why.

export type DriveEntry = { name: string; isDir: boolean; size: number };

export type DriveCommand =
  | { op: "list"; path: string[] }
  | { op: "stat"; path: string[] }
  | { op: "read"; path: string[]; offset: number; length: number }
  | { op: "write"; path: string[]; offset: number; data: string }
  | { op: "mkdir"; path: string[] }
  | { op: "rename"; from: string[]; to: string[] }
  | { op: "delete"; path: string[] };

export type DriveReply =
  | { type: "entries"; entries: DriveEntry[] }
  | { type: "stat"; entry: DriveEntry }
  | { type: "data"; data: string }
  | { type: "done" };

const refusalText: Record<string, string> = {
  "not-permitted": "Ask for Shared folder access first, then browse again.",
  "no-folder": "The computer has no shared folder set up.",
  "read-only": "The shared folder is read-only for this connection.",
  expired: "Shared folder access has expired. Ask again.",
  "unsafe-path": "That name is not allowed in the shared folder.",
  "too-large": "That transfer is larger than one step allows.",
  "reparse-point":
    "The computer will not follow links out of the shared folder.",
};

export class DriveRefused extends Error {
  constructor(readonly reason: string) {
    super(
      refusalText[reason] ?? `The computer refused the request (${reason}).`,
    );
  }
}

type Pending = {
  resolve: (reply: DriveReply) => void;
  reject: (error: Error) => void;
};

/** A channel-shaped sender, so the client can be tested without a real peer connection. */
export type DriveTransport = {
  send(text: string): void;
  readonly open: boolean;
};

export class DriveClient {
  private queue: Pending[] = [];
  private closed = false;

  constructor(private readonly transport: DriveTransport) {}

  /** Called for every text message the computer sends on the drive channel. */
  receive(text: string): void {
    const pending = this.queue.shift();
    if (!pending) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      pending.reject(new Error("The computer sent an unreadable reply."));
      return;
    }
    const reply = parsed as { type?: string; reason?: string };
    if (reply.type === "refused") {
      pending.reject(new DriveRefused(reply.reason ?? "unknown"));
    } else if (
      reply.type === "entries" ||
      reply.type === "stat" ||
      reply.type === "data" ||
      reply.type === "done"
    ) {
      pending.resolve(parsed as DriveReply);
    } else {
      pending.reject(new Error("The computer sent an unknown reply."));
    }
  }

  /** The channel ended: everything waiting is rejected at once. */
  close(): void {
    this.closed = true;
    for (const pending of this.queue.splice(0)) {
      pending.reject(new Error("The shared folder connection ended."));
    }
  }

  run(command: DriveCommand): Promise<DriveReply> {
    if (this.closed || !this.transport.open) {
      return Promise.reject(new Error("The shared folder is not connected."));
    }
    return new Promise<DriveReply>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.transport.send(JSON.stringify(command));
    });
  }

  list(path: string[]): Promise<DriveEntry[]> {
    return this.run({ op: "list", path }).then((reply) => {
      if (reply.type !== "entries")
        throw new Error("Unexpected reply to list.");
      return reply.entries;
    });
  }
}
