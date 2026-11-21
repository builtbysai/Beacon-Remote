// A small QR Code encoder (ISO/IEC 18004), written for the pairing link: byte mode, error correction level M,
// versions 1 to 10 (up to 213 bytes). It follows the standard's steps (data bits, Reed-Solomon, interleaving, function
// patterns, mask choice by penalty score, format and version bits) and returns the dark modules as a square grid.

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const QR_MAX_VERSION = 10;

const rawModules = (version: number): number => {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
};

const dataCodewords = (version: number): number =>
  Math.floor(rawModules(version) / 8) -
  ECC_PER_BLOCK[version]! * BLOCKS[version]!;

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const multiply = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;

function generator(degree: number): number[] {
  // The coefficients (without the leading 1) of the product of (x - 2^i) for i below degree.
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = multiply(root, 2);
  }
  return result;
}

function remainder(data: number[], degree: number): number[] {
  const gen = generator(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < degree; i++)
      result[i] = result[i]! ^ multiply(gen[i]!, factor);
  }
  return result;
}

// ---- Bits ----
function dataBits(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  return bits;
}

function toCodewords(bits: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j]!;
    out.push(value);
  }
  return out;
}

function interleave(data: number[], version: number): number[] {
  const blocks = BLOCKS[version]!;
  const ecc = ECC_PER_BLOCK[version]!;
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks) - ecc;
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, at = 0; i < blocks; i++) {
    const length = shortLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(at, at + length);
    at += length;
    dataBlocks.push(block);
    eccBlocks.push(remainder(block, ecc));
  }
  const result: number[] = [];
  for (let i = 0; i <= shortLength; i++)
    for (let b = 0; b < blocks; b++)
      if (i < dataBlocks[b]!.length) result.push(dataBlocks[b]![i]!);
  for (let i = 0; i < ecc; i++)
    for (let b = 0; b < blocks; b++) result.push(eccBlocks[b]![i]!);
  return result;
}

// ---- The grid ----
type Grid = { size: number; dark: boolean[][]; fixed: boolean[][] };

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step)
    result.splice(1, 0, pos);
  return result;
}

function blank(version: number): Grid {
  const size = version * 4 + 17;
  const make = () =>
    Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const grid: Grid = { size, dark: make(), fixed: make() };
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    grid.dark[y]![x] = dark;
    grid.fixed[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const positions = alignmentPositions(version);
  for (let i = 0; i < positions.length; i++)
    for (let j = 0; j < positions.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0)
      )
        continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(
            positions[i]! + dx,
            positions[j]! + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
    }
  // Reserve the format areas and the dark module; the real bits are written once the mask is known.
  for (let i = 0; i < 9; i++) {
    // Index 6 is part of the timing pattern and stays as it is.
    if (i === 6) continue;
    set(8, i, false);
    set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true);
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      set(size - 11 + (i % 3), Math.floor(i / 3), false);
      set(Math.floor(i / 3), size - 11 + (i % 3), false);
    }
  }
  return grid;
}

function place(grid: Grid, codewords: number[]) {
  const { size } = grid;
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (grid.fixed[y]![x] || bit >= total) continue;
        grid.dark[y]![x] =
          ((codewords[bit >>> 3]! >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function formatBits(mask: number): number {
  // Error correction level M is 00; BCH(15,5) with generator 0x537 and the 0x5412 mask.
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function writeFormat(grid: Grid, mask: number) {
  const { size } = grid;
  const bits = formatBits(mask);
  const get = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) grid.dark[i]![8] = get(i);
  grid.dark[7]![8] = get(6);
  grid.dark[8]![8] = get(7);
  grid.dark[8]![7] = get(8);
  for (let i = 9; i < 15; i++) grid.dark[8]![14 - i] = get(i);
  for (let i = 0; i < 8; i++) grid.dark[8]![size - 1 - i] = get(i);
  for (let i = 8; i < 15; i++) grid.dark[size - 15 + i]![8] = get(i);
  grid.dark[size - 8]![8] = true;
}

function writeVersion(grid: Grid, version: number) {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.dark[b]![a] = on;
    grid.dark[a]![b] = on;
  }
}

function penalty(grid: Grid): number {
  const { size, dark } = grid;
  let score = 0;
  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else run = 1;
      }
    }
  };
  runs((y, x) => dark[y]![x]!);
  runs((x, y) => dark[y]![x]!);
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = dark[y]![x]!;
      if (
        c === dark[y]![x + 1] &&
        c === dark[y + 1]![x] &&
        c === dark[y + 1]![x + 1]
      )
        score += 3;
    }
  const pattern = [
    true,
    false,
    true,
    true,
    true,
    false,
    true,
    false,
    false,
    false,
    false,
  ];
  const matches = (get: (k: number) => boolean) => {
    let found = 0;
    for (const reverse of [false, true])
      for (let k = 0; k < 11; k++) {
        const want = pattern[reverse ? 10 - k : k]!;
        if (get(k) !== want) break;
        if (k === 10) found++;
      }
    return found;
  };
  for (let i = 0; i < size; i++)
    for (let j = 0; j + 10 < size; j++) {
      score += 40 * matches((k) => dark[i]![j + k]!);
      score += 40 * matches((k) => dark[j + k]![i]!);
    }
  let count = 0;
  for (const row of dark) for (const cell of row) if (cell) count++;
  const percent = (count * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** Returns the QR code for [text] as rows of dark modules, or null if it does not fit versions 1 to 10. */
export function qrModules(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (
    version <= QR_MAX_VERSION &&
    bytes.length + (version >= 10 ? 3 : 2) > dataCodewords(version)
  )
    version++;
  if (version > QR_MAX_VERSION) return null;
  const codewords = interleave(toCodewords(dataBits(bytes, version)), version);
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = blank(version);
    place(grid, codewords);
    for (let y = 0; y < grid.size; y++)
      for (let x = 0; x < grid.size; x++)
        if (!grid.fixed[y]![x] && MASKS[mask]!(x, y))
          grid.dark[y]![x] = !grid.dark[y]![x];
    writeFormat(grid, mask);
    writeVersion(grid, version);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  return best!.dark;
}
