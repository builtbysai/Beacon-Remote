// Sending files to the computer over the approved session's file channel (ADR 0031).
//
// The computer decides where a file is saved and whether it is accepted; this side only offers a name and a
// size, streams the bytes in small chunks with back-pressure, and ends with the file's SHA-256 so the
// computer can reject anything that did not arrive intact.

const CHUNK = 16 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;

/** Incremental SHA-256: the browser's crypto API only hashes a whole buffer at once. */
export class Sha256 {
  private static readonly K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  private block = new Uint8Array(64);
  private filled = 0;
  private length = 0;
  private w = new Uint32Array(64);

  update(data: Uint8Array): this {
    this.length += data.length;
    let offset = 0;
    if (this.filled) {
      const take = Math.min(64 - this.filled, data.length);
      this.block.set(data.subarray(0, take), this.filled);
      this.filled += take;
      offset = take;
      if (this.filled === 64) {
        this.compress(this.block);
        this.filled = 0;
      }
    }
    while (offset + 64 <= data.length) {
      this.compress(data.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < data.length) {
      this.block.set(data.subarray(offset), 0);
      this.filled = data.length - offset;
    }
    return this;
  }

  hex(): string {
    const bits = this.length * 8;
    const pad = new Uint8Array((this.filled < 56 ? 56 : 120) - this.filled + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(bits / 0x100000000));
    view.setUint32(pad.length - 4, bits >>> 0);
    const copy = Object.create(Sha256.prototype) as Sha256;
    Object.assign(copy, this, {
      h: new Uint32Array(this.h),
      block: new Uint8Array(this.block),
      w: new Uint32Array(64),
    });
    copy.update(pad);
    return Array.from(copy.h, (word) =>
      word.toString(16).padStart(8, "0"),
    ).join("");
  }

  private compress(chunk: Uint8Array) {
    const w = this.w;
    const K = Sha256.K;
    for (let i = 0; i < 16; i += 1)
      w[i] =
        (chunk[i * 4]! << 24) |
        (chunk[i * 4 + 1]! << 16) |
        (chunk[i * 4 + 2]! << 8) |
        chunk[i * 4 + 3]!;
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 =
        ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h as unknown as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i += 1) {
      const S1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i += 1) this.h[i] = (this.h[i]! + next[i]!) | 0;
  }
}

export type Transfer = {
  name: string;
  size: number;
  sent: number;
  status: "waiting" | "sending" | "done" | "failed" | "cancelled";
  note?: string;
};

const REASONS: Record<string, string> = {
  "too-large": "The file is too large.",
  "session-full": "This session has received as much as it can.",
  busy: "The computer is still receiving another file.",
  name: "The computer cannot use that file name.",
  disk: "The computer could not save it.",
  paused: "Sharing is paused on the computer.",
  incomplete: "It did not arrive intact and was discarded.",
  write: "The computer could not save it.",
};

export class FileSender {
  ready = false;
  maxFile = 0;
  private next = 1;
  private cancelled = false;
  private waiter: ((reply: Record<string, unknown>) => void) | null = null;

  constructor(
    private readonly channel: RTCDataChannel,
    private readonly changed: (transfer: Transfer | null) => void,
    private readonly readyChanged: (ready: boolean) => void,
  ) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.t === "ready") {
        this.ready = true;
        this.maxFile = Number(message.maxFile) || 0;
        this.readyChanged(true);
      } else if (message.t === "paused") {
        this.cancelled = true;
        this.waiter?.(message);
      } else this.waiter?.(message);
    };
    channel.onclose = () => {
      this.ready = false;
      this.cancelled = true;
      this.waiter?.({ t: "failed", reason: "closed" });
      this.readyChanged(false);
    };
  }

  cancel() {
    this.cancelled = true;
    this.waiter?.({ t: "cancel" });
  }

  private reply(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  async send(file: File): Promise<void> {
    const id = this.next;
    this.next += 2;
    this.cancelled = false;
    const state: Transfer = {
      name: file.name,
      size: file.size,
      sent: 0,
      status: "waiting",
    };
    const show = (patch: Partial<Transfer>) => {
      Object.assign(state, patch);
      this.changed({ ...state });
    };
    if (!this.ready || this.channel.readyState !== "open")
      return show({
        status: "failed",
        note: "File transfer is not available.",
      });
    if (file.size === 0)
      return show({ status: "failed", note: "That file is empty." });
    if (this.maxFile && file.size > this.maxFile)
      return show({ status: "failed", note: REASONS["too-large"] });
    show({});
    this.channel.send(
      JSON.stringify({ t: "offer", id, name: file.name, size: file.size }),
    );
    const answer = await this.reply();
    if (answer.t !== "accept" || answer.id !== id)
      return show({
        status: answer.t === "cancel" ? "cancelled" : "failed",
        note:
          REASONS[String(answer.reason ?? "")] ??
          (answer.t === "cancel"
            ? undefined
            : "The computer did not accept it."),
      });
    show({ status: "sending" });
    const hash = new Sha256();
    const reader = file.stream().getReader();
    let pending = new Uint8Array(0);
    const flush = async (bytes: Uint8Array) => {
      const frame = new Uint8Array(4 + bytes.length);
      new DataView(frame.buffer).setUint32(0, id);
      frame.set(bytes, 4);
      while (this.channel.bufferedAmount > HIGH_WATER) {
        await new Promise<void>((resolve) => {
          this.channel.onbufferedamountlow = () => resolve();
        });
        if (this.cancelled) return;
      }
      if (this.channel.readyState !== "open") return;
      this.channel.send(frame);
      hash.update(bytes);
      state.sent += bytes.length;
      this.changed({ ...state });
    };
    try {
      for (;;) {
        if (this.cancelled) break;
        const { value, done } = await reader.read();
        if (done) break;
        let chunk = value;
        if (pending.length) {
          const joined = new Uint8Array(pending.length + chunk.length);
          joined.set(pending);
          joined.set(chunk, pending.length);
          chunk = joined;
          pending = new Uint8Array(0);
        }
        let offset = 0;
        while (chunk.length - offset >= CHUNK) {
          await flush(chunk.subarray(offset, offset + CHUNK));
          offset += CHUNK;
          if (this.cancelled) break;
        }
        pending = chunk.slice(offset);
      }
      if (!this.cancelled && pending.length) await flush(pending);
    } finally {
      reader.releaseLock?.();
    }
    if (this.cancelled || this.channel.readyState !== "open") {
      if (this.channel.readyState === "open")
        this.channel.send(JSON.stringify({ t: "cancel", id }));
      return show({ status: "cancelled" });
    }
    const finished = this.reply();
    this.channel.send(JSON.stringify({ t: "end", id, sha256: hash.hex() }));
    const result = await finished;
    if (result.t === "done")
      show({
        status: "done",
        sent: file.size,
        note: String(result.name ?? ""),
      });
    else
      show({
        status: "failed",
        note:
          REASONS[String(result.reason ?? "")] ??
          "The transfer did not finish.",
      });
  }
}
