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
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500";

export const labelClass =
  "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

export const helpClass = "mt-1 text-xs text-neutral-500 dark:text-neutral-400";

export const errorClass = "mt-1 text-xs text-rose-600 dark:text-rose-400";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-teal-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60";

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
    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
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

type BadgeTone = "neutral" | "teal" | "amber" | "rose" | "slate";

const badgeTones: Record<BadgeTone, string> = {
  neutral:
    "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
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
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      <dd className="text-sm text-neutral-900 dark:text-neutral-100">{children}</dd>
    </div>
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
          ? "bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300"
          : "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
      }`}
    >
      {message}
    </p>
  );
}
