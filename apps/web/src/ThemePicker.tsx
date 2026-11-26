export type Theme = "system" | "light" | "dark";
const storageKey = "beacon-remote-appearance";

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Appearance still works when browser storage is unavailable.
  }
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {theme === "system" ? (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      ) : theme === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
        </>
      ) : (
        <path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" />
      )}
    </svg>
  );
}

const labels: Record<Theme, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
};

/** The look actually shown: "System" follows the device's current preference. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

type ThemeProps = { theme: Theme; onChange: (theme: Theme) => void };

/** The header switch: light or dark, nothing else. Following the system is chosen in Settings. */
export function ThemePicker({ theme, onChange }: ThemeProps) {
  const current = resolveTheme(theme);
  const next = current === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-trigger"
      aria-label={`Appearance: ${labels[current]}`}
      title={`${labels[current]} · switch to ${labels[next].toLowerCase()}`}
      onClick={() => onChange(next)}
    >
      <ThemeIcon theme={current} />
    </button>
  );
}

/** The full choice, for Settings: System, Light or Dark. */
export function ThemeChoice({ theme, onChange }: ThemeProps) {
  return (
    <div className="theme-choice" role="radiogroup" aria-label="Appearance">
      {(["system", "light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          className="theme-choice-option"
          onClick={() => onChange(option)}
        >
          <ThemeIcon theme={option} />
          <span>{labels[option]}</span>
        </button>
      ))}
    </div>
  );
}
