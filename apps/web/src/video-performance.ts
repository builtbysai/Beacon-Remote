// WebRTC counters are cumulative. Differences between samples describe current
// video behaviour without letting an earlier stall dominate the whole session.
export type VideoCounters = {
  id: string;
  timestamp: number;
  bytesReceived?: number;
  framesDecoded?: number;
  framesDropped?: number;
  totalDecodeTime?: number;
  totalProcessingDelay?: number;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
};

export type VideoPerformance = {
  bitrateMbps: number | null;
  decodeMs: number | null;
  receiveToDecodeMs: number | null;
  jitterBufferMs: number | null;
  droppedFrames: number | null;
};

function difference(now?: number, before?: number): number | null {
  if (
    now === undefined ||
    before === undefined ||
    !Number.isFinite(now) ||
    !Number.isFinite(before) ||
    now < before ||
    before < 0
  )
    return null;
  return now - before;
}

export function videoPerformance(
  now: VideoCounters,
  before?: VideoCounters,
): VideoPerformance {
  const unavailable: VideoPerformance = {
    bitrateMbps: null,
    decodeMs: null,
    receiveToDecodeMs: null,
    jitterBufferMs: null,
    droppedFrames: null,
  };
  if (!before || now.id !== before.id) return unavailable;
  const elapsed = difference(now.timestamp, before.timestamp);
  if (elapsed === null || elapsed === 0) return unavailable;
  const frames = difference(now.framesDecoded, before.framesDecoded);
  const emitted = difference(
    now.jitterBufferEmittedCount,
    before.jitterBufferEmittedCount,
  );
  const averageMs = (total: number | null, count: number | null) =>
    total !== null && count !== null && count > 0
      ? (total * 1000) / count
      : null;
  const bytes = difference(now.bytesReceived, before.bytesReceived);
  return {
    bitrateMbps: bytes === null ? null : (bytes * 8) / elapsed / 1000,
    decodeMs: averageMs(
      difference(now.totalDecodeTime, before.totalDecodeTime),
      frames,
    ),
    // Includes buffering and decoding; these overlapping durations must not be added.
    receiveToDecodeMs: averageMs(
      difference(now.totalProcessingDelay, before.totalProcessingDelay),
      frames,
    ),
    jitterBufferMs: averageMs(
      difference(now.jitterBufferDelay, before.jitterBufferDelay),
      emitted,
    ),
    droppedFrames: difference(now.framesDropped, before.framesDropped),
  };
}
