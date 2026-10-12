import type { Page } from "./Product.js";

export const workspaceItems: { page: Page; label: string }[] = [
  { page: "computers", label: "Computers" },
  { page: "sessions", label: "Sessions" },
  { page: "assist", label: "Assist" },
  { page: "activity", label: "Activity" },
  { page: "downloads", label: "Downloads" },
  { page: "settings", label: "Settings" },
];

export function WorkspaceIcon({
  name,
}: {
  name: Page | "panel" | "more" | "signout";
}) {
  let lines;
  switch (name) {
    case "computers":
      lines = (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      );
      break;
    case "sessions":
      lines = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      );
      break;
    case "assist":
      lines = (
        <>
          <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
          <rect x="2" y="12" width="4" height="7" rx="2" />
          <rect x="18" y="12" width="4" height="7" rx="2" />
          <path d="M20 19a5 5 0 0 1-5 3h-3" />
        </>
      );
      break;
    case "activity":
      lines = (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
          <path d="M12 7v5l4 2" />
        </>
      );
      break;
    case "downloads":
      lines = (
        <>
          <path d="M12 3v12m-4-4 4 4 4-4" />
          <path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </>
      );
      break;
    case "settings":
      lines = (
        <>
          <path d="M9.6 3.6 10 2h4l.4 1.6 1.4.6 1.4-.8 2.8 2.8-.8 1.4.6 1.4L21 10v4l-1.6.4-.6 1.4.8 1.4-2.8 2.8-1.4-.8-1.4.6L14 22h-4l-.4-1.6-1.4-.6-1.4.8L4 17.8l.8-1.4-.6-1.4L2 14v-4l1.6-.4.6-1.4-.8-1.4L6.2 4l1.4.8 1.4-.6Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
      break;
    case "panel":
      lines = (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </>
      );
      break;
    case "more":
      lines = (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      );
      break;
    case "signout":
      lines = (
        <>
          <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
          <path d="M14 7l5 5-5 5M8 12h11" />
        </>
      );
      break;
    default:
      lines = <circle cx="12" cy="12" r="8" />;
  }
  return (
    <svg
      className="workspace-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {lines}
    </svg>
  );
}
