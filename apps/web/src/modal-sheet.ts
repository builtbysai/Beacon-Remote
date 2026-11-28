import { useEffect, useState, type RefObject } from "react";

/** True while `query` matches (for example while a side panel is shown as a bottom sheet). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}

/**
 * While `active`, the element behaves as a modal sheet: everything outside it is inert (no focus, no clicks, hidden
 * from assistive technology), focus moves into it, and on release focus returns to where it was. The same element
 * stays an ordinary, non-modal panel while `active` is false.
 */
export function useModalSheet(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const sheet = ref.current;
    if (!active || !sheet) return;
    const previous = document.activeElement;
    const background: { element: HTMLElement; inert: boolean }[] = [];
    for (
      let branch: HTMLElement | null = sheet;
      branch?.parentElement;
      branch = branch.parentElement
    ) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
    }
    if (!sheet.contains(document.activeElement)) {
      const first = sheet.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      (first ?? sheet).focus();
    }
    return () => {
      for (const { element, inert } of background) element.inert = inert;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [ref, active]);
}
