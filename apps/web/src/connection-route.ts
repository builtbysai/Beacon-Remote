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
