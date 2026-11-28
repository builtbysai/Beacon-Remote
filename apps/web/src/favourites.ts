/**
 * Favourite computers (the "address book" item on the roadmap): starred computers are listed first. Kept in this
 * browser only; a favourite grants nothing and changes no access.
 */
const KEY = "beacon-remote:favourites";

export function readFavourites(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(
      Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string").slice(0, 500)
        : [],
    );
  } catch {
    return new Set();
  }
}

export function toggleFavourite(id: string): Set<string> {
  const next = readFavourites();
  if (next.has(id)) next.delete(id);
  else next.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // Storage blocked: the star lasts for this page only.
  }
  return next;
}

/** Favourites first; otherwise the list keeps its own order. */
export function favouritesFirst<T extends { id: string }>(
  list: T[],
  favourites: Set<string>,
): T[] {
  return [
    ...list.filter((entry) => favourites.has(entry.id)),
    ...list.filter((entry) => !favourites.has(entry.id)),
  ];
}
