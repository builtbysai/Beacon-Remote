// Ctrl+V in the viewer types the viewer's clipboard text on the computer (ADR 0021). The computer's
// own clipboard is never read or sent anywhere. Text becomes the same bounded input the channel
// already accepts: short type_text pieces, with Enter and Tab as real keys.
export type PasteInput =
  | { type: "type_text"; text: string }
  | { type: "key"; scanCode: number; extended: boolean; down: boolean };

export const PASTE_LIMIT = 4000;
const PIECE = 200;
const ENTER = 0x1c;
const TAB = 0x0f;

const press = (scanCode: number): PasteInput[] => [
  { type: "key", scanCode, extended: false, down: true },
  { type: "key", scanCode, extended: false, down: false },
];

export function pasteSteps(source: string): {
  steps: PasteInput[];
  truncated: boolean;
} {
  const characters = Array.from(source.replace(/\r\n?/g, "\n"));
  const truncated = characters.length > PASTE_LIMIT;
  const steps: PasteInput[] = [];
  let piece = "";
  let units = 0;
  const flush = () => {
    if (piece) steps.push({ type: "type_text", text: piece });
    piece = "";
    units = 0;
  };
  for (const character of characters.slice(0, PASTE_LIMIT)) {
    if (character === "\n" || character === "\t") {
      flush();
      steps.push(...press(character === "\n" ? ENTER : TAB));
      continue;
    }
    const code = character.codePointAt(0)!;
    // Other controls (and the C1 range) would be rejected by the channel; drop them.
    if (code < 32 || (code >= 127 && code <= 159)) continue;
    if (units + character.length > PIECE) flush();
    piece += character;
    units += character.length;
  }
  flush();
  return { steps, truncated };
}
