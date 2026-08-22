import type { ReactNode } from "react";

/**
 * Shared presentational primitives.
 *
 * Deliberately plain server components with exported class-name constants
 * rather than a component per input type: the dynamic field renderer needs to
 * apply the same styling to inputs it builds on the fly, and passing class
 * strings around is simpler than wrapping every native element.
 */

export const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500";

export const labelClass =
  "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export const helpClass = "mt-1 text-xs text-neutral-500 dark:text-neutral-400";

export const errorClass = "mt-1 text-xs text-rose-600 dark:text-rose-400";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-accent-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:opacity-60";

export const btnSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800";

export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-300 bg-white px-3.5 py-2 text-sm font-medium text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900 dark:bg-neutral-900 dark:text-rose-400 dark:hover:bg-rose-950/40";

export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * A card whose header is the thing you press to open it.
 *
 * For sections that are occasionally useful rather than usually read — sharing, gifts —
 * where a permanently expanded card costs a screenful to say nothing. A native
 * <details> again: it works before hydration and adds no client bundle.
 *
 * The divider moves to the top of the content rather than the bottom of the header, so
 * a closed card does not end in a rule with nothing under it.
 */
export function CollapsibleCard({
  title,
  description,
  meta,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Shown at the right of the summary — a count, usually. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 marker:content-none">
          <div className="flex min-w-0 items-center gap-2">
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
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {title}
              </h2>
              {description ? (
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {meta ? (
            <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {meta}
            </span>
          ) : null}
        </summary>
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          {children}
        </div>
      </details>
    </Card>
  );
}

export function PageHeader({
  title,
  description,
  action,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Rendered to the left of the title — a contact's photo, for instance. */
  icon?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {title}
      </p>
      {description ? (
        <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "amber" | "rose" | "slate";

const badgeTones: Record<BadgeTone, string> = {
  neutral:
    "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  accent: "bg-accent-100 text-accent-800 dark:bg-accent-950 dark:text-accent-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Label + value pair used across detail pages. */
export function DetailRow({
  label,
  children,
  compact = false,
}: {
  label: ReactNode;
  children: ReactNode;
  /**
   * For a narrow sidebar. The 11rem label column is right in a wide card and wrong in
   * a 22rem one, where it leaves so little room that a timestamp wraps onto three
   * lines — which is what made the Record card look like it had escaped its border.
   */
  compact?: boolean;
}) {
  return (
    <div
      className={`grid gap-0.5 px-4 py-2 ${
        compact ? "" : "sm:grid-cols-[11rem_1fr] sm:gap-4 sm:px-5 sm:py-2.5"
      }`}
    >
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      {/* min-w-0 lets a long unbroken value (a Google resource id, say) shrink and
          wrap instead of pushing the grid wider than its card. */}
      <dd className="min-w-0 break-words text-sm text-neutral-900 dark:text-neutral-100">
        {children}
      </dd>
    </div>
  );
}

/**
 * Explanation on hover, rather than permanently on screen.
 *
 * A paragraph explaining a control is read once and then occupies space forever. The
 * title attribute alone is not enough — it never appears on touch, and it is invisible
 * to anyone who does not think to hover — so the trigger is a focusable marker that
 * also opens on keyboard focus, and the text is exposed to assistive technology.
 */
export function Hint({ children, label = "What is this?" }: { children: ReactNode; label?: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="flex size-4 cursor-help items-center justify-center rounded-full border border-neutral-300 text-[10px] font-semibold leading-none text-neutral-500 transition hover:border-neutral-400 hover:text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 dark:border-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        ?
      </button>
      <span
        role="tooltip"
        /*
          Anchored under the button on a real screen; pinned to the bottom of the viewport
          on a phone.
          
          A 16rem box centred on its button is 14px too wide for a 390px screen whenever the
          button sits near the right edge, and that made the whole PAGE scroll sideways — the
          overflow of a hover tooltip becoming the most visible thing about the app on a
          phone. Width alone cannot fix it: max-width clamps the box without moving it. So
          below sm it stops being anchored at all, which cannot overflow by construction.
        */
        className="pointer-events-none fixed inset-x-3 bottom-3 z-30 rounded-md border border-neutral-200 bg-white p-2 text-xs font-normal leading-relaxed text-neutral-600 opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-full sm:mt-1.5 sm:w-64 sm:-translate-x-1/2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
      >
        {children}
      </span>
    </span>
  );
}

export function FormMessage({
  ok,
  message,
}: {
  ok?: boolean;
  message?: string;
}) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={`rounded-md px-3 py-2 text-sm ${
        ok
          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          : "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
      }`}
    >
      {message}
    </p>
  );
}
