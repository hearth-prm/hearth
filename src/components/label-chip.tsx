import Link from "next/link";
import { resolveLabelColor, type LabelColor } from "@/lib/labels";

/**
 * Chip styles per colour token.
 *
 * Written out rather than composed from a template string because Tailwind scans
 * source for complete class names — `bg-${color}-100` would be stripped from the
 * build and the chips would render unstyled.
 */
const chipTones: Record<LabelColor, string> = {
  slate:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  indigo:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  violet:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
};

const base =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export interface LabelSummary {
  id: string;
  name: string;
  color: string | null;
}

export function LabelChip({ label }: { label: LabelSummary }) {
  return (
    <span className={`${base} ${chipTones[resolveLabelColor(label.name, label.color)]}`}>
      {label.name}
    </span>
  );
}

/** A chip that filters the contact list to this label when clicked. */
export function LabelChipLink({ label }: { label: LabelSummary }) {
  const tone = chipTones[resolveLabelColor(label.name, label.color)];
  return (
    <Link
      href={`/people?label=${encodeURIComponent(label.id)}`}
      className={`${base} ${tone} transition hover:brightness-95 dark:hover:brightness-125`}
      title={`Show contacts labelled “${label.name}”`}
    >
      {label.name}
    </Link>
  );
}

export function LabelChips({
  labels,
  linked = false,
}: {
  labels: readonly LabelSummary[];
  linked?: boolean;
}) {
  if (labels.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {labels.map((l) =>
        linked ? <LabelChipLink key={l.id} label={l} /> : <LabelChip key={l.id} label={l} />,
      )}
    </span>
  );
}

/** The swatch used in the colour picker on the label settings page. */
export function colorSwatchClass(color: LabelColor): string {
  return chipTones[color];
}
