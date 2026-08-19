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
  middleName: "Middle name",
  familyName: "Family name",
  honorificPrefix: "Title",
  honorificSuffix: "Suffix",
  phoneticGivenName: "Given name (phonetic)",
  phoneticMiddleName: "Middle name (phonetic)",
  phoneticFamilyName: "Family name (phonetic)",
  nickname: "Nickname",
  organization: "Organisation",
  jobTitle: "Job title",
  orgDepartment: "Department",
  orgJobDescription: "Job description",
  orgSymbol: "Ticker symbol",
  orgDomain: "Organisation domain",
  orgLocation: "Office",
  orgPhoneticName: "Organisation (phonetic)",
  orgType: "Organisation type",
  gender: "Gender",
  birthday: "Birthday",
  birthdayText: "Birthday (no year)",
  notes: "Notes",
  labels: "Labels",
  emails: "Emails",
  phones: "Phones",
  addresses: "Addresses",
  urls: "URLs",
  social: "Social",
  im: "Chat",
  sip: "SIP",
  calendar: "Calendar",
  externalIds: "External ids",
  keywords: "Keywords",
  interests: "Interests",
  skills: "Skills",
  occupations: "Occupations",
  locations: "Locations",
  otherNicknames: "Other nicknames",
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
  IM: COLUMNS.im,
  SIP: COLUMNS.sip,
  CALENDAR: COLUMNS.calendar,
  EXTERNAL_ID: COLUMNS.externalIds,
  KEYWORD: COLUMNS.keywords,
  INTEREST: COLUMNS.interests,
  SKILL: COLUMNS.skills,
  OCCUPATION: COLUMNS.occupations,
  LOCATION: COLUMNS.locations,
  NICKNAME: COLUMNS.otherNicknames,
};

/**
 * Addresses get a column per part, in numbered blocks.
 *
 * The `Addresses` column above holds one line per address and cannot carry street, city
 * and postcode without a nested format inside the cell — which is unreadable in a
 * spreadsheet and unparseable without guessing. So each address also gets its own block
 * of plain columns: `Address 1 city`, `Address 2 postcode`, and so on.
 *
 * How many blocks is decided by the data. An export emits as many as its widest contact
 * needs and none at all when nobody has an address, rather than padding every file with
 * empty columns for the three-address case. The import reads however many it finds, which
 * is why it scans headers for the pattern instead of a fixed list.
 *
 * `Addresses` stays, and is still read: it is the human-readable form, it is what older
 * exports and hand-written files contain, and the blocks are what preserve the shape.
 */
export const ADDRESS_PART_COLUMNS = [
  ["label", "type"],
  ["value", "line"],
  ["streetAddress", "street"],
  ["extendedAddress", "extra"],
  ["city", "city"],
  ["region", "region"],
  ["postalCode", "postcode"],
  ["country", "country"],
  ["countryCode", "country code"],
  ["poBox", "PO box"],
] as const;

export type AddressPartKey = (typeof ADDRESS_PART_COLUMNS)[number][0];

/** `Address 2 city`. One-based, because a spreadsheet reader counts from one. */
export function addressColumn(slot: number, suffix: string): string {
  return `Address ${slot + 1} ${suffix}`;
}

export function addressColumnsFor(slots: number): string[] {
  const out: string[] = [];
  for (let slot = 0; slot < slots; slot++) {
    for (const [, suffix] of ADDRESS_PART_COLUMNS) out.push(addressColumn(slot, suffix));
  }
  return out;
}

/** How many address blocks a file has, found by looking for the last one present. */
export function addressSlotsIn(headers: readonly string[]): number {
  const present = new Set(headers);
  let slots = 0;
  // Any part counts: a file with only `Address 1 city` still describes one address.
  while (ADDRESS_PART_COLUMNS.some(([, suffix]) => present.has(addressColumn(slots, suffix)))) {
    slots += 1;
  }
  return slots;
}

export interface CsvAddress {
  label: string | null;
  value: string;
  streetAddress: string | null;
  extendedAddress: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  countryCode: string | null;
  poBox: string | null;
}

/**
 * Read the address blocks out of one row.
 *
 * A block with no line and no street is an empty slot rather than an address; a block
 * with parts but no line gets one built from them, so a spreadsheet user can fill in the
 * pieces and leave the summary alone.
 */
export function parseAddressBlocks(
  read: (column: string) => string,
  slots: number,
): CsvAddress[] {
  const out: CsvAddress[] = [];

  for (let slot = 0; slot < slots; slot++) {
    const at = (key: AddressPartKey) => {
      const suffix = ADDRESS_PART_COLUMNS.find(([k]) => k === key)?.[1] ?? key;
      return cleanCell(read(addressColumn(slot, suffix))) || null;
    };

    const parts = {
      streetAddress: at("streetAddress"),
      extendedAddress: at("extendedAddress"),
      city: at("city"),
      region: at("region"),
      postalCode: at("postalCode"),
      country: at("country"),
      countryCode: at("countryCode"),
      poBox: at("poBox"),
    };

    const line =
      at("value") ??
      [parts.streetAddress, parts.city, parts.region, parts.postalCode, parts.country]
        .filter(Boolean)
        .join(", ");
    if (!line) continue;

    out.push({ label: at("label"), value: line, ...parts });
  }

  return out;
}

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
  /**
   * Address parts, when the file carried the blocks.
   *
   * Declared here rather than left as excess properties on a spread: TypeScript does not
   * check those, so parts read from a file would have been carried this far and then
   * dropped at the write without a word — parsed, believed, and lost.
   */
  streetAddress?: string | null;
  extendedAddress?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
  poBox?: string | null;
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
/**
 * `addressSlots` is decided by the rows being written, not by a constant.
 *
 * Which means the header row depends on the data — unusual, and the reason it is a
 * parameter rather than something this function works out: the export knows how wide its
 * widest contact is, and a file for people with no addresses should not carry ten empty
 * address columns to prove it.
 */
export function headersFor(
  customFields: readonly FieldDef[],
  addressSlots = 0,
): string[] {
  return [
    ...Object.values(COLUMNS),
    ...addressColumnsFor(addressSlots),
    ...customFields.map(customHeader),
  ];
}
