// A key event carries the modifier state it happened under, but not every source sends a separate
// event for each modifier (remote browser automation, a window gaining focus mid-hold, a missed
// keyup). The viewer lines up the computer's held modifiers with each event's flags, so a shortcut
// always has its modifier and a stale one is released. Codes are scan | 0x100 when extended.
export type ModifierFlags = {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
};
const GROUPS: { flag: keyof ModifierFlags; codes: number[] }[] = [
  { flag: "ctrl", codes: [0x1d, 0x11d] },
  { flag: "shift", codes: [0x2a, 0x36] },
  { flag: "alt", codes: [0x38, 0x138] },
  { flag: "meta", codes: [0x15b, 0x15c] },
];
export const isModifierCode = (code: number) =>
  GROUPS.some((group) => group.codes.includes(code));

export function modifierChanges(
  held: ReadonlySet<number>,
  flags: ModifierFlags,
): { code: number; down: boolean }[] {
  const changes: { code: number; down: boolean }[] = [];
  for (const group of GROUPS) {
    const down = group.codes.filter((code) => held.has(code));
    if (flags[group.flag] && !down.length)
      changes.push({ code: group.codes[0]!, down: true });
    else if (!flags[group.flag])
      for (const code of down) changes.push({ code, down: false });
  }
  return changes;
}
