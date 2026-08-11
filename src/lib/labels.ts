/**
 * Labels: user-defined groupings for contacts.
 *
 * Kept free of Prisma and React so the name rules can be tested directly and
 * reused by CSV import, which has to decide "is this the same label?" for
 * thousands of rows without touching the database.
 */

/** Colour tokens a label chip can use. Names are stable — they reach the database. */
export const LABEL_COLORS = [
  "slate",
  "red",
  "amber",
  "green",
  "teal",
  "sky",
  "indigo",
  "violet",
  "pink",
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

export function isLabelColor(value: string): value is LabelColor {
  return (LABEL_COLORS as readonly string[]).includes(value);
}

export const MAX_LABEL_NAME = 60;

/**
 * Tidy a typed label name.
 *
 * Collapses internal whitespace as well as trimming, so "Book  club" and
 * "Book club" cannot become two labels that look identical in every list.
 */
export function normaliseLabelName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_NAME);
}

/**
 * The key two label names are considered the same under.
 *
 * Case-insensitive, because a user typing "family" after creating "Family" means
 * the one they already have — and Google contact groups are matched by name too, so
 * treating case as significant would create a second group that looks like a
 * duplicate on the phone.
 */
export function labelKey(name: string): string {
  return normaliseLabelName(name).toLowerCase();
}

/**
 * A stable colour for a label that has not chosen one.
 *
 * Deterministic on the name so a chip does not change colour between renders or
 * between users, and so an unstyled label still looks deliberate rather than grey.
 */
export function defaultLabelColor(name: string): LabelColor {
  const key = labelKey(name);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length]!;
}

export function resolveLabelColor(name: string, color: string | null): LabelColor {
  return color && isLabelColor(color) ? color : defaultLabelColor(name);
}

/**
 * Split a CSV cell of labels into names.
 *
 * Semicolons separate, not commas: a CSV cell containing commas has to be quoted,
 * and a label list is exactly the field most likely to be hand-edited in a
 * spreadsheet where that quoting is easy to break. Commas are still accepted on the
 * way in, since someone will type them.
 */
export function parseLabelList(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of cell.split(/[;,]/)) {
    const name = normaliseLabelName(part);
    if (!name) continue;
    const key = labelKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Render label names back into one CSV cell. */
export function formatLabelList(names: readonly string[]): string {
  return names.join("; ");
}
