// A computer that was removed and set up again comes back as a new entry with a new identity key (ADR 0062). This says
// whether a computer looks like such a replacement: it is active and a removed one has the same name.
type Entry = { id: string; name: string; revokedAt?: string | null };

const same = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function replacesRemoved(
  machine: Entry,
  all: readonly Entry[],
): boolean {
  if (machine.revokedAt) return false;
  return all.some(
    (other) =>
      other.id !== machine.id &&
      Boolean(other.revokedAt) &&
      same(other.name, machine.name),
  );
}
