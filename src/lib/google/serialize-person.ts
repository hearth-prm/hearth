import type { ContactPoint, Person } from "@prisma/client";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import type { FieldDef } from "@/lib/fields/types";
import type { GooglePerson } from "./people-client";

/**
 * Turn a Hearth person into a Google People API resource.
 *
 * Pure on purpose: no database, no network, no clock. It is the piece most likely
 * to be wrong in a way that quietly corrupts someone's address book, so it needs
 * to be exhaustively testable without credentials.
 */

/** Custom field Google shows on the contact, linking it back to Hearth. */
export const HEARTH_ID_KEY = "hearth_id";

/**
 * The field groups Hearth owns.
 *
 * This list is passed to Google as `updatePersonFields` on every update, which
 * means Google replaces each group with exactly what we send. Sending the full
 * list — rather than only the groups that happen to be populated — is what makes
 * clearing a field locally also clear it in Google. The cost is that anything
 * edited directly in Google inside these groups is overwritten on the next push,
 * which is precisely the "Hearth is the source of truth" contract.
 */
export const MANAGED_PERSON_FIELDS = [
  "names",
  "nicknames",
  "organizations",
  "birthdays",
  "biographies",
  "emailAddresses",
  "phoneNumbers",
  "addresses",
  "urls",
  "userDefined",
] as const;

export type PersonWithContacts = Person & { contactPoints: ContactPoint[] };

export interface SerializeOptions {
  /** Registry entries for user-defined fields; omit or empty to not push them. */
  customFields?: readonly FieldDef[];
}

function clean(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : undefined;
}

/** Google's `type` is free text; a null label just means "no type given". */
function typeOf(cp: ContactPoint): string | undefined {
  return clean(cp.label);
}

function sortPoints(points: readonly ContactPoint[]): ContactPoint[] {
  // Primary first, then declared order — Google treats the first entry of each
  // group as the primary one.
  return [...points].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.order - b.order,
  );
}

export function serializePerson(
  person: PersonWithContacts,
  options: SerializeOptions = {},
): { person: GooglePerson; updateFields: string[] } {
  const points = sortPoints(person.contactPoints);
  const byKind = (kind: ContactPoint["kind"]) => points.filter((p) => p.kind === kind);

  const given = clean(person.givenName);
  const family = clean(person.familyName);

  // Google renders a contact with no name at all as a blank row, so fall back to
  // the display name Hearth already computes (which itself falls back to
  // nickname, then organisation).
  const names: GooglePerson["names"] =
    given || family
      ? [{ givenName: given, familyName: family }]
      : [{ givenName: clean(person.displayName) ?? "Unnamed contact" }];

  const nickname = clean(person.nickname);
  const organization = clean(person.organization);
  const jobTitle = clean(person.jobTitle);
  const notes = clean(person.notes);

  const userDefined: NonNullable<GooglePerson["userDefined"]> = [
    { key: HEARTH_ID_KEY, value: person.id },
  ];

  // Social handles have no home in the People API schema — they are not URLs and
  // there is no "social" group — so they become custom fields rather than being
  // silently dropped.
  for (const cp of byKind("SOCIAL")) {
    const value = clean(cp.value);
    if (value) userDefined.push({ key: typeOf(cp) ?? "social", value });
  }

  for (const def of options.customFields ?? []) {
    const raw = readFieldValue(person as unknown as Record<string, unknown>, def);
    const text = formatFieldValue(def, raw);
    if (text) userDefined.push({ key: def.label || def.key, value: text });
  }

  const google: GooglePerson = {
    names,
    nicknames: nickname ? [{ value: nickname }] : [],
    organizations:
      organization || jobTitle ? [{ name: organization, title: jobTitle }] : [],
    // @db.Date columns come back as an instant at UTC midnight, so the components
    // must be read in UTC or the date shifts a day west of Greenwich.
    birthdays: person.birthday
      ? [
          {
            date: {
              year: person.birthday.getUTCFullYear(),
              month: person.birthday.getUTCMonth() + 1,
              day: person.birthday.getUTCDate(),
            },
          },
        ]
      : [],
    biographies: notes ? [{ value: notes, contentType: "TEXT_PLAIN" }] : [],
    emailAddresses: byKind("EMAIL")
      .map((cp) => ({ value: clean(cp.value), type: typeOf(cp) }))
      .filter((e) => e.value !== undefined),
    phoneNumbers: byKind("PHONE")
      .map((cp) => ({ value: clean(cp.value), type: typeOf(cp) }))
      .filter((e) => e.value !== undefined),
    addresses: byKind("ADDRESS")
      .map((cp) => ({ formattedValue: clean(cp.value), type: typeOf(cp) }))
      .filter((e) => e.formattedValue !== undefined),
    urls: byKind("URL")
      .map((cp) => ({ value: clean(cp.value), type: typeOf(cp) }))
      .filter((e) => e.value !== undefined),
    userDefined,
  };

  return { person: google, updateFields: [...MANAGED_PERSON_FIELDS] };
}

/** Read Hearth's id back off a Google contact, for reconciliation. */
export function hearthIdOf(person: GooglePerson): string | null {
  const match = person.userDefined?.find((u) => u.key === HEARTH_ID_KEY);
  return match?.value ?? null;
}
