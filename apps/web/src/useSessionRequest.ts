import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import type { ViewGrant } from "./LiveView.js";
import { resolveViewRequest } from "./view-request.js";

export type SessionRequest = (
  create: () => Promise<{ grant: ViewGrant; name: string }>,
) => Promise<void>;

// One request across all Assist entry points; discarded grants are explicitly
// stopped, rather than aborting the response and losing their identifiers.
export function useSessionRequest(
  onClaimed: (grant: ViewGrant, name: string) => boolean | void,
  sessionActive: boolean,
) {
  const context = useRef({
    live: true,
    pending: false,
    claimed: sessionActive,
  });
  const callback = useRef(onClaimed);
  callback.current = onClaimed;
  const [pending, setPending] = useState(false);
  useEffect(() => {
    context.current.claimed = sessionActive;
  }, [sessionActive]);
  useEffect(() => {
    const current = {
      live: true,
      pending: false,
      claimed: context.current.claimed,
    };
    context.current = current;
    const leave = () => {
      current.live = false;
    };
    window.addEventListener("hashchange", leave);
    return () => {
      current.live = false;
      window.removeEventListener("hashchange", leave);
    };
    // A new context belongs to a new component lifetime, not a new render.
  }, []);
  const request: SessionRequest = async (create) => {
    const current = context.current;
    if (!current.live || current.pending || current.claimed) return;
    const accept = callback.current;
    current.pending = true;
    setPending(true);
    try {
      await resolveViewRequest(
        create(),
        () => current.live && !current.claimed,
        (result) => {
          current.claimed = true;
          if (accept(result.grant, result.name) === false) {
            current.claimed = false;
            void api(`sessions/${result.grant.id}/stop`, {}).catch(() => {});
          }
        },
        (result) => api(`sessions/${result.grant.id}/stop`, {}),
      );
    } finally {
      current.pending = false;
      if (current.live) setPending(false);
    }
  };
  return { request, pending };
}
