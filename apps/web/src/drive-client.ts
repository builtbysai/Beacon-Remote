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

/** Largest read or write one step asks for; matches the computer's bound. */
export const DRIVE_CHUNK = 256 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Reads a whole file from the shared folder in bounded steps. `onProgress` gets bytes so far. */
export async function readFile(
  client: DriveClient,
  path: string[],
  size: number,
  onProgress?: (done: number) => void,
): Promise<Uint8Array> {
  const out = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  while (offset < size) {
    const length = Math.min(DRIVE_CHUNK, size - offset);
    const reply = await client.run({ op: "read", path, offset, length });
    if (reply.type !== "data") throw new Error("Unexpected reply to read.");
    const chunk = base64ToBytes(reply.data);
    if (chunk.length === 0)
      throw new Error("The file changed while it was read.");
    out.set(chunk, offset);
    offset += chunk.length;
    onProgress?.(offset);
  }
  return out;
}

/** Writes a file into the shared folder in bounded steps, starting from an empty file. */
export async function writeFile(
  client: DriveClient,
  path: string[],
  bytes: Uint8Array,
  onProgress?: (done: number) => void,
): Promise<void> {
  let offset = 0;
  // An empty file is created by writing nothing useful; the computer rejects zero-length writes, so skip it.
  if (bytes.length === 0) throw new Error("Empty files are not sent.");
  while (offset < bytes.length) {
    const chunk = bytes.subarray(offset, offset + DRIVE_CHUNK);
    await client.run({ op: "write", path, offset, data: bytesToBase64(chunk) });
    offset += chunk.length;
    onProgress?.(offset);
  }
}

export const driveOps = {
  mkdir: (client: DriveClient, path: string[]) =>
    client.run({ op: "mkdir", path }),
  rename: (client: DriveClient, from: string[], to: string[]) =>
    client.run({ op: "rename", from, to }),
  remove: (client: DriveClient, path: string[]) =>
    client.run({ op: "delete", path }),
  stat: (client: DriveClient, path: string[]) =>
    client.run({ op: "stat", path }),
};
