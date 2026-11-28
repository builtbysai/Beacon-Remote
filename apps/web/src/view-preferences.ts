/**
 * Harmless per-computer viewer choices (review R23): how the picture is scaled and how touch drives the pointer.
 * Kept in this browser only. Never permissions, grants, trust exceptions, microphone or recording state.
 */
export type ViewScale = "fit" | "actual" | "150" | "200";
const SCALES: readonly ViewScale[] = ["fit", "actual", "150", "200"];
export type ViewPreferences = {
  scale?: ViewScale;
  touch?: "trackpad" | "direct";
};

const key = (machineId: string) => `beacon-remote:view:${machineId}`;

export function readViewPreferences(
  machineId: string | undefined,
): ViewPreferences {
  if (!machineId) return {};
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(key(machineId)) ?? "{}",
    );
    if (!raw || typeof raw !== "object") return {};
    const value = raw as Record<string, unknown>;
    const choices: ViewPreferences = {};
    if (SCALES.includes(value.scale as ViewScale))
      choices.scale = value.scale as ViewScale;
    if (value.touch === "trackpad" || value.touch === "direct")
      choices.touch = value.touch;
    return choices;
  } catch {
    return {};
  }
}

export function saveViewPreferences(
  machineId: string | undefined,
  change: ViewPreferences,
) {
  if (!machineId) return;
  try {
    localStorage.setItem(
      key(machineId),
      JSON.stringify({ ...readViewPreferences(machineId), ...change }),
    );
  } catch {
    // Storage full or blocked: the choice simply is not remembered.
  }
}
