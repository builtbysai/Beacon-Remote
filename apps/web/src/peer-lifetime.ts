// A brief ICE interruption can recover on the same authorized peer. Explicit
// Stop/signaling termination and expiry remain immediate in the caller.
export function peerLifetime(
  interrupted: () => void,
  ended: () => void,
  schedule: (callback: () => void, milliseconds: number) => () => void = (
    callback,
    milliseconds,
  ) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
) {
  let cancel: (() => void) | undefined;
  let disposed = false;
  return {
    update(state: RTCPeerConnectionState) {
      if (disposed) return;
      if (state === "disconnected") {
        if (!cancel) {
          interrupted();
          cancel = schedule(() => {
            if (!disposed) ended();
          }, 3000);
        }
      } else {
        cancel?.();
        cancel = undefined;
        if (state === "failed" || state === "closed") ended();
      }
    },
    dispose() {
      disposed = true;
      cancel?.();
      cancel = undefined;
    },
  };
}
