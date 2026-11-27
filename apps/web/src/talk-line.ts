// The phone's optional "talk" line is an audio section in its offer that it only receives on. This returns the media
// ids of such sections, so the viewer knows which of its audio transceivers it may send its microphone on. (The phone's
// own sound, when shared, is an audio section the phone sends on; that one is never listed.)
export function talkMids(sdp: string): string[] {
  const sections = sdp.replace(/\r/g, "").split("\nm=").slice(1);
  const mids: string[] = [];
  for (const section of sections) {
    if (!section.startsWith("audio ")) continue;
    const lines = section.split("\n");
    if (!lines.includes("a=recvonly")) continue;
    const mid = lines.find((line) => line.startsWith("a=mid:"));
    if (mid) mids.push(mid.slice("a=mid:".length));
  }
  return mids;
}
