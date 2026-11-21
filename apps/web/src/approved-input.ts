import { parseDisplay } from "./remote-input.js";

export const approvedInputPrefix = "beacon-approved-input-v1:";

// Signaling and the data channel can arrive in either order. Only the current
// request's channel may wait for approval, and at most its latest geometry.
export function approvedInput(
  pending: (id: string) => boolean,
  attach: (channel: RTCDataChannel, geometry?: string) => void,
) {
  let approved: string | undefined;
  let staged:
    { id: string; channel: RTCDataChannel; geometry?: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function unstage() {
    clearTimeout(timer);
    const previous = staged;
    staged = undefined;
    if (previous) {
      previous.channel.onmessage = null;
      previous.channel.onclose = null;
    }
    return previous;
  }
  function discard() {
    unstage()?.channel.close();
  }
  return {
    offer(channel: RTCDataChannel) {
      const id = channel.label.slice(approvedInputPrefix.length);
      if (id === approved) {
        approved = undefined;
        attach(channel);
      } else if (pending(id) && !staged) {
        staged = { id, channel };
        channel.onmessage = ({ data }) => {
          if (staged?.channel !== channel) return;
          if (
            typeof data !== "string" ||
            data.length > 512 ||
            !parseDisplay(data)
          )
            discard();
          else staged.geometry = data;
        };
        channel.onclose = unstage;
        timer = setTimeout(discard, 31_000);
      } else {
        channel.close();
      }
    },
    result(id: string, allow: boolean) {
      if (!allow) {
        if (staged?.id === id) discard();
        return;
      }
      const match = staged?.id === id ? unstage() : undefined;
      if (match) attach(match.channel, match.geometry);
      else approved = id;
    },
    dispose() {
      approved = undefined;
      discard();
    },
  };
}
