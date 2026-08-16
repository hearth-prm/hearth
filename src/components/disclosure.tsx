import type { ReactNode } from "react";

/**
 * A titled section that starts collapsed.
 *
 * A native <details> rather than React state, for the same reason the filter menu is
 * one: it opens on the very first click, before any JavaScript has hydrated, and it
 * costs no client bundle. Everything here is server-rendered, so making these client
 * components would be paying for interactivity the element already has.
 */
export function Disclosure({
  title,
  meta,
  children,
  defaultOpen = false,
  className = "",
}: {
  title: ReactNode;
  /** Shown to the right of the title — a count, a date. */
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-sm text-neutral-700 marker:content-none dark:text-neutral-300">
        {/* Rotates to point down when open. Inline SVG rather than a glyph so it
            follows the text colour and sits on the text baseline at any size. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-90"
          aria-hidden
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="min-w-0 flex-1">{title}</span>
        {meta ? (
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            {meta}
          </span>
        ) : null}
      </summary>
      <div className="pb-1 pl-5.5">{children}</div>
    </details>
  );
}
