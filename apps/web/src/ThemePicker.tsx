import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

const choices: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

type ThemeProps = { theme: Theme; onChange: (theme: Theme) => void };

export function ThemeOptions({ theme, onChange }: ThemeProps) {
  const name = useId();
  return (
    <div className="theme-options">
      {choices.map((choice) => (
        <label className="theme-choice" key={choice.value}>
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={theme === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <ThemeIcon theme={choice.value} />
          <span>{choice.label}</span>
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
    </div>
  );
}

export function AppearanceSettings(props: ThemeProps) {
  return (
    <fieldset className="appearance-settings">
      <legend>Appearance</legend>
      <ThemeOptions {...props} />
    </fieldset>
  );
}

export function ThemePicker({ theme, onChange }: ThemeProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLFieldSetElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 0 });
  const label = choices.find((choice) => choice.value === theme)!.label;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const below = y + height - rect.bottom - 16;
      const above = rect.top - y - 16;
      const panelHeight = 176;
      const useBelow = below >= panelHeight || below >= above;
      const available = Math.max(44, useBelow ? below : above);
      setPosition({
        left: Math.max(x + 8, Math.min(rect.right - 184, x + width - 192)),
        top: useBelow
          ? rect.bottom + 8
          : Math.max(y + 8, rect.top - Math.min(panelHeight, available) - 8),
        maxHeight: available,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
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
          !event.currentTarget.contains(event.relatedTarget) &&
          !panel.current?.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab" && open) {
          // The panel is portalled above shell layers. Resume the header's
          // natural tab order instead of jumping to the end of the document.
          setOpen(false);
          trigger.current?.focus();
        }
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
      </button>
      {open &&
        createPortal(
          <fieldset
            className="theme-panel"
            id={panelId}
            style={position}
            ref={panel}
          >
            <legend>Appearance</legend>
            <ThemeOptions theme={theme} onChange={onChange} />
          </fieldset>,
          document.body,
        )}
    </div>
  );
}
