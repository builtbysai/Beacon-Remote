// Small line icons for the viewer's toolbar. Each is 24x24, drawn with the current text colour.
const paths: Record<string, string> = {
  back: "M15 5l-7 7 7 7",
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z",
  recents:
    "M6 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
  keyboard:
    "M3 7h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM6 10.5h.01M10 10.5h.01M14 10.5h.01M18 10.5h.01M7.5 14h9",
  copyFrom:
    "M9 4h8a1 1 0 0 1 1 1v3M7 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9.5 14.5L12 17l2.5-2.5M12 11.5V17",
  sendTo:
    "M9 4h8a1 1 0 0 1 1 1v3M7 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9.5 14L12 11.5 14.5 14M12 11.5V17",
  lock: "M7 11h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  record: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z",
  fullscreen:
    "M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  sound:
    "M5 9.5h3L12 6v12l-4-3.5H5zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11",
  mute: "M5 9.5h3L12 6v12l-4-3.5H5zM16 9.5l4 5M20 9.5l-4 5",
  file: "M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M12 17v-5M9.5 14.5L12 12l2.5 2.5",
  device:
    "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  end: "M6 6l12 12M18 6L6 18",
  panel:
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM15 5v14",
};

export function ViewerIcon({ name }: { name: keyof typeof paths | string }) {
  if (name === "more")
    return (
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="5.5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="18.5" cy="12" r="1.8" />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name] ?? paths.more} />
    </svg>
  );
}
