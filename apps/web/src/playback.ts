// A browser can settle play() after Stop, unmount, or a replaced grant.
// Commit the result only while the request's original session is still live.
export async function playForSession(
  play: () => Promise<void>,
  isLive: () => boolean,
  onPlaying: () => void,
  onBlocked: () => void,
): Promise<void> {
  if (!isLive()) return;
  try {
    await play();
  } catch {
    if (isLive()) onBlocked();
    return;
  }
  if (isLive()) onPlaying();
}
