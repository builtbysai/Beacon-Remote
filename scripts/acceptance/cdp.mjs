/** Bounded request/reply transport. A closed browser rejects every pending call. */
export function cdpConnection(socket, timeoutMs = 10_000) {
  let next = 0,
    closed = false;
  const pending = new Map();
  const fail = () => {
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(Error("Browser connection closed"));
    }
    pending.clear();
  };
  socket.onclose = fail;
  socket.onerror = fail;
  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(Error("Browser command failed"));
    else entry.resolve(message);
  };
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closed || socket.readyState !== 1) {
        reject(Error("Browser connection closed"));
        return;
      }
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Browser command timed out"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(Error("Browser command failed"));
      }
    });
}
