import { useEffect, useId, useRef, useState } from "react";

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

const choices: { value: Theme; label: string; detail: string }[] = [
  { value: "system", label: "System", detail: "Match your device" },
  { value: "light", label: "Light", detail: "Always light" },
  { value: "dark", label: "Dark", detail: "Always dark" },
];

export function ThemePicker({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = choices.find((choice) => choice.value === theme)!.label;

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      className="theme-picker"
      ref={root}
      onBlur={(event) => {
        // Label pointer activation can briefly blur a radio with no related
        // target before focusing the newly selected input. Outside pointerdown
        // already dismisses the panel; don't unmount its labels mid-click.
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="theme-trigger"
        ref={trigger}
        aria-label={`Appearance: ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        title={`Appearance: ${label}`}
        onClick={() => setOpen(!open)}
      >
        <ThemeIcon theme={theme} />
        <span>{label}</span>
        <svg
          className="theme-chevron"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <fieldset className="theme-panel" id={panelId}>
          <legend>Appearance</legend>
          {choices.map((choice) => (
            <label className="theme-choice" key={choice.value}>
              <input
                type="radio"
                name={panelId}
                value={choice.value}
                checked={theme === choice.value}
                onChange={() => onChange(choice.value)}
              />
              <ThemeIcon theme={choice.value} />
              <span>
                <strong>{choice.label}</strong>
                <small>{choice.detail}</small>
              </span>
              <svg
                className="theme-check"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m3 8 3 3 7-7" />
              </svg>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
