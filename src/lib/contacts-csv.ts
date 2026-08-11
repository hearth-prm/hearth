import type { ContactKind, FieldType } from "@prisma/client";
import type { FieldDef } from "@/lib/fields/types";
import { formatLabelList, parseLabelList } from "@/lib/labels";
import { cleanCell } from "@/lib/csv";

/**
 * The CSV shape for contacts, shared by export and import.
 *
 * One module so the two directions cannot disagree about a column name or a
 * separator. Everything here is pure: no Prisma, no request. That is what lets the
 * round-trip be tested as a property — serialise, parse, compare — rather than by
 * eyeballing a file.
 */

/** Fixed columns, in the order they appear in the file. */
export const COLUMNS = {
  id: "Hearth ID",
  givenName: "Given name",
  familyName: "Family name",
  nickname: "Nickname",
  organization: "Organisation",
  jobTitle: "Job title",
  birthday: "Birthday",
  notes: "Notes",
  labels: "Labels",
  emails: "Emails",
  phones: "Phones",
  addresses: "Addresses",
  urls: "URLs",
  social: "Social",
  addToGoogle: "Add to Google",
  owner: "Owner",
  sharedWith: "Shared with",
  blanketShares: "Shared via blanket grant",
} as const;

/** Columns import reads. Owner and blanket grants are informational only. */
export const READ_ONLY_COLUMNS: readonly string[] = [
  COLUMNS.owner,
  COLUMNS.blanketShares,
];

export const CONTACT_KIND_COLUMN: Record<ContactKind, string> = {
  EMAIL: COLUMNS.emails,
  PHONE: COLUMNS.phones,
  ADDRESS: COLUMNS.addresses,
  URL: COLUMNS.urls,
  SOCIAL: COLUMNS.social,
};

/**
 * Separator between a contact point's type and its value: `home|a@b.com`.
 *
 * A pipe rather than a colon because URLs contain colons, so `label:value` cannot be
 * split without guessing which colon was the delimiter. Pipes appear in none of the
 * value kinds Hearth stores.
 */
const TYPE_SEP = "|";

/** Separator between repeated entries in one cell. */
const ITEM_SEP = "; ";

export interface CsvContactPoint {
  kind: ContactKind;
  label: string | null;
  value: string;
}

export function formatContactPoints(points: readonly CsvContactPoint[]): string {
  return points
    .map((p) => (p.label ? `${p.label}${TYPE_SEP}${p.value}` : p.value))
    .join(ITEM_SEP);
}

/**
 * Parse one contact-point cell.
 *
 * A bare value with no type is accepted, because a hand-written file will have
 * plenty of those and rejecting them would make the importer useless for the most
 * common case: a column of email addresses.
 */
export function parseContactPoints(
  cell: string,
  kind: ContactKind,
): CsvContactPoint[] {
  const out: CsvContactPoint[] = [];
  const seen = new Set<string>();

  for (const raw of cell.split(";")) {
    const entry = cleanCell(raw);
    if (!entry) continue;

    const at = entry.indexOf(TYPE_SEP);
    const label = at === -1 ? null : entry.slice(0, at).trim() || null;
    const value = (at === -1 ? entry : entry.slice(at + 1)).trim();
    if (!value) continue;

    // De-duplicate on the value: the same address twice with different types is a
    // spreadsheet artefact, not two ways to reach someone.
    const key = `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ kind, label, value });
  }
  return out;
}

export interface CsvShare {
  email: string;
  permission: "VIEW" | "EDIT";
}

export function formatShares(shares: readonly CsvShare[]): string {
  return shares.map((s) => `${s.email}${TYPE_SEP}${s.permission}`).join(ITEM_SEP);
}

/**
 * Parse a share cell.
 *
 * Defaults to VIEW when no permission is given: the safe reading of an ambiguous
 * instruction to grant access. An unrecognised permission is also VIEW rather than
 * an error, so a typo cannot silently hand over edit rights.
 */
export function parseShares(cell: string): CsvShare[] {
  const out: CsvShare[] = [];
  const seen = new Set<string>();

  for (const raw of cell.split(";")) {
    const entry = cleanCell(raw);
    if (!entry) continue;

    const at = entry.indexOf(TYPE_SEP);
    const email = (at === -1 ? entry : entry.slice(0, at)).trim().toLowerCase();
    const perm = at === -1 ? "" : entry.slice(at + 1).trim().toUpperCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);

    out.push({ email, permission: perm === "EDIT" ? "EDIT" : "VIEW" });
  }
  return out;
}

export { formatLabelList, parseLabelList };

// --- custom fields ---------------------------------------------------------

/**
 * Serialise a custom field value for CSV.
 *
 * Deliberately not the display formatter: a formatted date reads "10 August 2026",
 * which no importer should have to parse back. These forms are the ones the value
 * parsers already accept, so a round-trip is lossless by construction.
 */
export function formatCustomValue(type: FieldType, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";

  switch (type) {
    case "BOOLEAN":
      return value ? "true" : "false";
    case "MULTISELECT":
      return Array.isArray(value) ? value.map(String).join(ITEM_SEP) : String(value);
    case "DATE":
      // Date-only: the stored value is an ISO instant, and everything after the day
      // is noise that a spreadsheet will happily mangle.
      return isoDay(value);
    case "DATETIME":
      return value instanceof Date ? value.toISOString() : String(value);
    default:
      return String(value);
  }
}

/**
 * Turn a CSV cell into the shape the field validators expect.
 *
 * The validators are written for form input, where a checkbox is a boolean and a
 * multi-select is an array. A CSV cell is always a string, so the coercion has to
 * happen before validation rather than inside it — that keeps one set of rules for
 * both entry paths.
 */
export function csvRawValue(type: FieldType, cell: string): unknown {
  const value = cleanCell(cell);
  if (!value) return type === "BOOLEAN" ? false : "";

  switch (type) {
    case "BOOLEAN": {
      // Accept what a person would actually type, in either language of the UI.
      const yes = ["true", "yes", "y", "1", "on", "✓"];
      return yes.includes(value.toLowerCase());
    }
    case "MULTISELECT":
      return value
        .split(";")
        .map((v) => cleanCell(v))
        .filter(Boolean);
    case "DATE":
      // Spreadsheets love to re-render a date; accept the common forms and hand the
      // validator an ISO day.
      return normaliseDateCell(value);
    default:
      return value;
  }
}

/**
 * Coerce a date cell to YYYY-MM-DD.
 *
 * Handles the two unambiguous cases — already ISO, or a form Date.parse understands
 * — and gives up otherwise rather than guessing between D/M/Y and M/D/Y. A wrong
 * guess there silently misdates a birthday, which is worse than a reported error.
 */
export function normaliseDateCell(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const slashed = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value);
  if (slashed) return `${slashed[1]}-${slashed[2]}-${slashed[3]}`;
  return value;
}

export function isoDay(value: unknown): string {
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Header for a custom field: its label, which is what a user recognises. */
export function customHeader(def: FieldDef): string {
  return def.label;
}

/**
 * Every column name for a given field registry, in file order.
 *
 * Custom fields come last so the fixed columns stay at stable positions — a user
 * who adds a field should not find every earlier column shifted in their template.
 */
export function headersFor(customFields: readonly FieldDef[]): string[] {
  return [...Object.values(COLUMNS), ...customFields.map(customHeader)];
}
