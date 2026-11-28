export type ConnectionRoute = "Direct" | "Relayed" | "Unavailable";

/**
 * Labels the selected ICE pair for the viewer. A relay on either side is always Relayed, even under
 * relay-only policy. Host, server-reflexive and peer-reflexive candidates on both sides are Direct:
 * a peer-reflexive candidate is found by a connectivity check on the direct path, not through a relay.
 */
export function classifyConnectionRoute(
  local: string,
  remote: string,
  policy: RTCIceTransportPolicy | string | undefined,
): ConnectionRoute {
  if (policy === "relay" || local === "relay" || remote === "relay")
    return "Relayed";
  const direct = ["host", "srflx", "prflx"];
  if (direct.includes(local) && direct.includes(remote)) return "Direct";
  return "Unavailable";
}

/**
 * One plain answer for the Connection panel (review R27), before the counters: whether to wait, retry or check the
 * network. Counters stay below for people who want them.
 */
export function connectionAdvice(
  route: string,
  ice: RTCIceConnectionState,
  fps: number | null,
): string {
  if (ice === "failed") return "Lost · try reconnecting or check the network";
  if (ice === "disconnected") return "Interrupted · reconnecting";
  if (ice === "new" || ice === "checking") return "Connecting…";
  if (fps !== null && fps < 8) return "Picture is slow · the network is busy";
  if (route === "Relayed") return "Good · through the relay";
  if (route === "Direct") return "Good · direct";
  return "Connected";
}
