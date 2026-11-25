import { useEffect, useId, useRef, useState } from "react";
import type { Page } from "./Product.js";
import { WorkspaceIcon } from "./WorkspaceIcon.js";

export function AccountMenu({
  page,
  onSignOut,
}: {
  page: Page;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const inMenu = page === "settings" || page === "downloads";

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      className="account-menu"
      ref={root}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === "Tab") setOpen(false);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ??
              [],
          );
          const at = items.indexOf(document.activeElement as HTMLElement);
          const step = event.key === "ArrowDown" ? 1 : -1;
          items[(at + step + items.length) % items.length]?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className={`account-trigger${inMenu ? " is-current" : ""}`}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title="Account"
        onClick={() => setOpen(!open)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M4.8 20c.9-3.6 3.7-5.4 7.2-5.4s6.3 1.8 7.2 5.4" />
        </svg>
      </button>
      {open && (
        <div className="account-popover" id={menuId} role="menu">
          <a
            role="menuitem"
            href="#settings"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <WorkspaceIcon name="settings" />
            Settings
          </a>
          <a
            role="menuitem"
            href="#downloads"
            aria-current={page === "downloads" ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <WorkspaceIcon name="downloads" />
            Downloads
          </a>
          <hr />
          <button
            type="button"
            role="menuitem"
            className="workspace-signout"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <WorkspaceIcon name="signout" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
