/**
 * The last picture seen of each computer, so a view that is between streams (Windows putting the password prompt
 * away, the switch from the sign-in screen to the desktop) keeps showing it instead of a black screen. Kept in memory
 * for this page only, one per computer, and never sent anywhere.
 */
const frames = new Map<string, string>();

/** A still of what the video shows now, or null when it shows nothing yet. */
export function captureFrame(video: HTMLVideoElement | null): string | null {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

export function rememberFrame(machineId: string, frame: string | null) {
  if (frame) frames.set(machineId, frame);
}

export function lastFrame(machineId: string): string | undefined {
  return frames.get(machineId);
}

/** Forget a computer's picture when its view is closed on purpose, so a later visit does not show an old screen. */
export function forgetFrame(machineId: string) {
  frames.delete(machineId);
}
