/** Measures this exact input channel; a peer cannot supply its own claimed clock or duration. */
export function inputLatency(
  now: () => number,
  send: (id: number) => boolean,
  onSample: (milliseconds: number | null) => void,
) {
  let next = 0;
  let pending: { id: number; at: number } | undefined;
  let lastRequest = -Infinity;
  let closed = false;
  return {
    tick(eligible: boolean) {
      if (closed) return;
      const time = now();
      if (!eligible) {
        if (pending) onSample(null);
        pending = undefined;
        return;
      }
      if (pending) {
        if (time - pending.at >= 3000) {
          pending = undefined;
          onSample(null);
        }
        return;
      }
      if (time - lastRequest < 2000) return;
      pending = { id: ++next, at: time };
      lastRequest = time;
      if (!send(pending.id)) pending = undefined;
    },
    receive(id: unknown): boolean {
      if (!Number.isSafeInteger(id) || (id as number) <= 0) return false;
      if (!closed && pending && pending.id === id) {
        const elapsed = now() - pending.at;
        pending = undefined;
        onSample(elapsed >= 0 && elapsed < 3000 ? elapsed : null);
      }
      return true;
    },
    close() {
      closed = true;
      pending = undefined;
      onSample(null);
    },
  };
}
